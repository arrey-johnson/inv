/**
 * Document PDF renderer - overlay architecture.
 *
 *   for every output page:
 *     1. draw the OFFICIAL LETTERHEAD PDF as the page background (embedded once, reused)
 *     2. draw dynamic content (title, parties, items table, totals, notes) inside the safe area
 *     3. draw the company stamp PNG in the reserved bottom-right zone (every page when stamped)
 *
 * Server-only: the letterhead and stamp bytes must be loaded from private storage / the local
 * `assets/branding/source` folder by the caller and passed in `PdfRenderAssets`. This module never
 * touches the file system or the network, which keeps it unit-testable.
 *
 * Money is never recomputed here - the renderer prints what `calculateDocument` produced.
 */
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { amountInWordsXAF } from "@/lib/finance/amount-in-words";
import {
  currencyLabel,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from "@/lib/finance/format";
import { formatDate } from "@/lib/utils/dates";
import { DOCUMENT_LAYOUT, PAGE, STAMP_LAYOUT, getStampRect } from "./layout";
import type {
  PdfDocumentData,
  PdfDocumentStatus,
  PdfDocumentType,
  PdfParty,
  PdfRenderAssets,
  PdfRenderOptions,
} from "./types";

const L = DOCUMENT_LAYOUT;
const C = L.colors;
const color = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

const TITLES: Record<PdfDocumentType, string> = {
  invoice: "INVOICE",
  proforma: "PROFORMA INVOICE",
  credit_note: "CREDIT NOTE",
  receipt: "PAYMENT RECEIPT",
  advance: "ADVANCE INVOICE",
};

const NO_STAMP_STATUSES: ReadonlySet<PdfDocumentStatus> = new Set(["draft", "void"]);

/** Whether the stamp should be printed for this document. */
export function shouldApplyStamp(
  status: PdfDocumentStatus,
  override?: boolean,
): boolean {
  if (override !== undefined) return override;
  return !NO_STAMP_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Standard PDF fonts only support WinAnsi: replace anything else so drawText never throws. */
export function sanitize(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text.replace(/\u00a0/g, " ").replace(/[\t\r]/g, " ")) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n") out += ch;
    else if (supported.has(cp)) out += ch;
    else if (cp === 0x202f || cp === 0x2009) out += " ";
    else out += "?";
  }
  return out;
}

export function wrapText(
  rawText: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const text = sanitize(rawText, font);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/ +/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    const pushLongWord = (word: string) => {
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      return chunk;
    };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = font.widthOfTextAtSize(word, size) > maxWidth ? pushLongWord(word) : word;
      }
    }
    lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

class PdfBuilder {
  readonly pdf: PDFDocument;
  pages: PDFPage[] = [];
  page!: PDFPage;
  /** Current baseline cursor (PDF y). */
  y = 0;

  private regular!: PDFFont;
  private bold!: PDFFont;
  private italic!: PDFFont;
  private letterhead!: PDFEmbeddedPage;
  private stamp: PDFImage | null = null;

  constructor(
    private readonly data: PdfDocumentData,
    private readonly assets: PdfRenderAssets,
    private readonly options: PdfRenderOptions,
    pdf: PDFDocument,
  ) {
    this.pdf = pdf;
  }

  static async create(
    data: PdfDocumentData,
    assets: PdfRenderAssets,
    options: PdfRenderOptions,
  ): Promise<PdfBuilder> {
    const pdf = await PDFDocument.create();
    const builder = new PdfBuilder(data, assets, options, pdf);
    await builder.init();
    return builder;
  }

  private async init() {
    const { pdf, assets } = this;
    this.regular = await pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    this.italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const [letterhead] = await pdf.embedPdf(assets.letterheadPdf, [0]);
    this.letterhead = letterhead;

    if (assets.stampPng && shouldApplyStamp(this.data.status, this.options.applyStamp)) {
      this.stamp = await pdf.embedPng(assets.stampPng);
    }
  }

  // -- pages ---------------------------------------------------------------

  addPage(isFirst: boolean) {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    // 1. letterhead background
    page.drawPage(this.letterhead, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });
    this.pages.push(page);
    this.page = page;
    this.y = isFirst ? L.safeArea.firstPageTop : L.safeArea.continuationTop;
  }

  /** Lowest y content may reach; clears the stamp zone on every page when a stamp is applied. */
  private contentBottom(): number {
    if (!this.stamp) return L.safeArea.bottom;
    const rect = getStampRect(this.stamp.width, this.stamp.height, this.options.stampLayout);
    return rect.top + STAMP_LAYOUT.clearance + 8;
  }

  private ensureSpace(height: number, bottom?: number): boolean {
    const floor = bottom ?? this.contentBottom();
    if (this.y - height >= floor) return false;
    this.addPage(false);
    this.drawContinuationHeader();
    return true;
  }

  private drawContinuationHeader() {
    const { data } = this;
    this.text(`${TITLES[data.type]} ${data.number}`, L.margins.left, this.y - 4, {
      font: this.bold,
      size: L.fonts.heading,
      color: C.purple,
    });
    this.y -= 24;
  }

  // -- primitive drawing ---------------------------------------------------

  private text(
    value: string,
    x: number,
    y: number,
    opts: { font?: PDFFont; size?: number; color?: { r: number; g: number; b: number }; align?: "left" | "right"; opacity?: number } = {},
  ) {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? L.fonts.body;
    const safe = sanitize(value, font).replace(/\n/g, " ");
    const width = font.widthOfTextAtSize(safe, size);
    this.page.drawText(safe, {
      x: opts.align === "right" ? x - width : x,
      y,
      font,
      size,
      color: color(opts.color ?? C.text),
      opacity: opts.opacity,
    });
    return width;
  }

  private rect(x: number, y: number, w: number, h: number, fill: { r: number; g: number; b: number }) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: color(fill) });
  }

  private hline(x1: number, x2: number, y: number, c: { r: number; g: number; b: number } = C.rule, thickness = 0.5) {
    this.page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness,
      color: color(c),
    });
  }

  private lineHeight(size: number) {
    return size * L.fonts.lineHeightRatio;
  }

  /** Draw wrapped text in a column, returns the number of lines drawn. Moves no cursor. */
  private paragraph(
    value: string,
    x: number,
    yTop: number,
    width: number,
    opts: { font?: PDFFont; size?: number; color?: { r: number; g: number; b: number } } = {},
  ): number {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? L.fonts.body;
    const lines = wrapText(value, font, size, width);
    lines.forEach((line, i) => {
      this.text(line, x, yTop - size - i * this.lineHeight(size) + size * 0.2, {
        font,
        size,
        color: opts.color,
      });
    });
    return lines.length;
  }

  // -- document sections -----------------------------------------------------

  async render(): Promise<Uint8Array> {
    this.addPage(true);
    this.drawTitleAndMeta();
    this.drawParties();
    this.drawItemsTable();
    this.drawClosing();
    this.drawPageDecorations();
    return this.pdf.save();
  }

  private drawTitleAndMeta() {
    const { data } = this;
    const left = L.margins.left;
    const right = PAGE.width - L.margins.right;

    // Title: sits under the logo (logo bottom ~ y 771), left aligned.
    const titleBaseline = L.safeArea.firstPageTop - 6;
    this.text(TITLES[data.type], left, titleBaseline, {
      font: this.bold,
      size: L.fonts.title,
      color: C.purple,
    });
    this.text(`No. ${data.number}`, left, titleBaseline - 18, {
      font: this.bold,
      size: L.fonts.heading,
    });

    // Meta block: right aligned label/value pairs, below the header diamonds (bottom ~ y 718).
    const rows: Array<{ label: string; value: string }> = [
      { label: "Issue date", value: formatDate(data.issueDate) },
    ];
    if (data.dueDate) rows.push({ label: "Due date", value: formatDate(data.dueDate) });
    rows.push(...(data.metaRows ?? []));
    rows.push({ label: "Currency", value: `${data.currency} (${currencyLabel(data.currency)})` });

    let metaY = titleBaseline - 18;
    const valueX = right;
    const labelX = right - 150;
    for (const row of rows) {
      this.text(row.label, labelX, metaY, { size: L.fonts.small, color: C.muted });
      const wrapped = wrapText(row.value, this.bold, L.fonts.small, 120);
      wrapped.forEach((line, i) => {
        this.text(line, valueX, metaY - i * this.lineHeight(L.fonts.small), {
          font: this.bold,
          size: L.fonts.small,
          align: "right",
        });
      });
      metaY -= Math.max(1, wrapped.length) * this.lineHeight(L.fonts.small) + 2;
    }

    this.y = Math.min(titleBaseline - 52, metaY - 8);
  }

  private partyLines(party: PdfParty): string[] {
    const lines: string[] = [];
    for (const line of party.addressLines ?? []) {
      if (line && line.trim()) lines.push(line.trim());
    }
    if (party.niu?.trim()) lines.push(`NIU: ${party.niu.trim()}`);
    if (party.rccm?.trim()) lines.push(`RCCM: ${party.rccm.trim()}`);
    if (party.phone?.trim()) lines.push(`Tel: ${party.phone.trim()}`);
    if (party.email?.trim()) lines.push(party.email.trim());
    return lines;
  }

  private drawParties() {
    const { data } = this;
    const left = L.margins.left;
    const colWidth = (L.contentWidth - 20) / 2;
    const rightX = left + colWidth + 20;
    const size = L.fonts.body;
    const lh = this.lineHeight(size);

    const blocks: Array<{ x: number; heading: string; party: PdfParty }> = [
      { x: left, heading: data.type === "receipt" ? "RECEIVED FROM" : "BILLED TO", party: data.customer },
      { x: rightX, heading: "ISSUED BY", party: data.issuer },
    ];

    const top = this.y;
    let tallest = 0;
    for (const block of blocks) {
      this.text(block.heading, block.x, top - 8, { font: this.bold, size: L.fonts.small, color: C.purple });
      this.hline(block.x, block.x + colWidth, top - 12, C.lilac, 0.75);
      let cursor = top - 12 - 4;
      const nameLines = wrapText(block.party.name, this.bold, L.fonts.heading, colWidth);
      nameLines.forEach((line) => {
        cursor -= this.lineHeight(L.fonts.heading);
        this.text(line, block.x, cursor + 3, { font: this.bold, size: L.fonts.heading });
      });
      for (const raw of this.partyLines(block.party)) {
        for (const line of wrapText(raw, this.regular, size, colWidth)) {
          cursor -= lh;
          this.text(line, block.x, cursor + 2, { size, color: C.text });
        }
      }
      tallest = Math.max(tallest, top - cursor);
    }
    this.y = top - tallest - 18;
  }

  // -- items table -------------------------------------------------------------

  private columns() {
    const c = L.table.columns;
    const fixed = c.index + c.quantity + c.unitPrice + c.discount + c.total;
    const description = L.contentWidth - fixed;
    const x0 = L.margins.left;
    const xs = {
      index: x0,
      description: x0 + c.index,
      quantity: x0 + c.index + description,
      unitPrice: x0 + c.index + description + c.quantity,
      discount: x0 + c.index + description + c.quantity + c.unitPrice,
      total: x0 + c.index + description + c.quantity + c.unitPrice + c.discount,
    };
    return { xs, widths: { ...c, description }, right: x0 + L.contentWidth };
  }

  private drawTableHeader() {
    const { xs, widths, right } = this.columns();
    const h = L.table.headerHeight;
    const pad = L.table.rowPaddingX;
    this.rect(L.margins.left, this.y - h, L.contentWidth, h, C.purple);
    const baseline = this.y - h + 7;
    const style = { font: this.bold, size: L.fonts.small, color: C.white } as const;
    this.text("#", xs.index + pad, baseline, style);
    this.text("Description", xs.description + pad, baseline, style);
    this.text("Qty", xs.quantity + widths.quantity - pad, baseline, { ...style, align: "right" });
    this.text("Unit HT", xs.unitPrice + widths.unitPrice - pad, baseline, { ...style, align: "right" });
    this.text("Disc.", xs.discount + widths.discount - pad, baseline, { ...style, align: "right" });
    this.text("Amount HT", right - pad, baseline, { ...style, align: "right" });
    this.y -= h;
  }

  private drawItemsTable() {
    const { data } = this;
    const { xs, widths, right } = this.columns();
    const size = L.fonts.body;
    const pad = L.table.rowPaddingX;
    const padY = L.table.rowPaddingY;
    const lh = this.lineHeight(size);

    this.ensureSpace(L.table.headerHeight + 30);
    this.drawTableHeader();

    data.lines.forEach((line, idx) => {
      const descLines = wrapText(line.description, this.regular, size, widths.description - pad * 2);
      const detailLines = line.details
        ? wrapText(line.details, this.italic, L.fonts.small, widths.description - pad * 2)
        : [];
      const rowHeight =
        padY * 2 + descLines.length * lh + detailLines.length * this.lineHeight(L.fonts.small);

      if (this.ensureSpace(rowHeight)) {
        this.drawTableHeader();
      }

      const top = this.y;
      if (idx % 2 === 1) this.rect(L.margins.left, top - rowHeight, L.contentWidth, rowHeight, C.tint);

      let cursor = top - padY;
      descLines.forEach((text) => {
        cursor -= lh;
        this.text(text, xs.description + pad, cursor + 2.5, { size });
      });
      detailLines.forEach((text) => {
        cursor -= this.lineHeight(L.fonts.small);
        this.text(text, xs.description + pad, cursor + 2, { font: this.italic, size: L.fonts.small, color: C.muted });
      });

      const baseline = top - padY - lh + 2.5;
      this.text(String(idx + 1), xs.index + pad, baseline, { size, color: C.muted });
      const qty = `${formatQuantity(line.quantity)}${line.unit ? ` ${line.unit}` : ""}`;
      this.text(qty, xs.quantity + widths.quantity - pad, baseline, { size, align: "right" });
      this.text(formatNumber(line.unitPrice, data.currency), xs.unitPrice + widths.unitPrice - pad, baseline, { size, align: "right" });
      this.text(line.discountLabel ?? "-", xs.discount + widths.discount - pad, baseline, { size, align: "right", color: line.discountLabel ? C.text : C.muted });
      this.text(formatNumber(line.netAmount, data.currency), right - pad, baseline, { font: this.bold, size, align: "right" });

      this.y -= rowHeight;
      this.hline(L.margins.left, right, this.y);
    });

    this.y -= 14;
  }

  // -- totals, words, notes --------------------------------------------------

  private totalsRows() {
    const { data } = this;
    const { calc } = data;
    const money = (v: number) => formatMoney(v, data.currency);
    type Row = { label: string; value: string; style?: "normal" | "strong" | "grand" | "muted" };
    const rows: Row[] = [];

    rows.push({ label: "Subtotal", value: money(calc.subtotal) });
    if (calc.globalDiscountAmount > 0) {
      rows.push({ label: "Global discount", value: `- ${money(calc.globalDiscountAmount)}`, style: "muted" });
    }
    rows.push({ label: "Net total (HT)", value: money(calc.netHT), style: "strong" });
    for (const group of calc.taxBreakdown) {
      if (group.rate === 0 && group.taxAmount === 0 && calc.taxBreakdown.length > 1) {
        rows.push({ label: "Exempt / 0% base", value: money(group.taxableAmount), style: "muted" });
      } else {
        rows.push({ label: `VAT ${formatPercent(group.rate)}`, value: money(group.taxAmount) });
      }
    }
    rows.push({ label: "Total VAT", value: money(calc.taxTotal), style: "muted" });
    rows.push({ label: "TOTAL (TTC)", value: money(calc.totalTTC), style: "grand" });
    for (const w of calc.withholdings) {
      rows.push({ label: `Withholding ${w.code} (${formatPercent(w.rate)})`, value: `- ${money(w.amount)}`, style: "muted" });
    }
    if (calc.withholdings.length > 0) {
      rows.push({ label: "Net payable", value: money(calc.netPayable), style: "strong" });
    }
    if (data.settlement) {
      if (data.settlement.rows && data.settlement.rows.length > 0) {
        for (const row of data.settlement.rows) rows.push({ label: row.label, value: `- ${money(row.amount)}`, style: "muted" });
      } else {
        rows.push({ label: "Paid / credited", value: `- ${money(data.settlement.paidAmount)}`, style: "muted" });
      }
      rows.push({ label: "Balance due", value: money(data.settlement.balanceDue), style: "grand" });
    }
    return rows;
  }

  private drawClosing() {
    const { data } = this;
    const rows = this.totalsRows();
    const rowH = L.totals.rowHeight;
    const totalsHeight = rows.length * rowH + 6;
    // Totals sit in the bottom-right stamp zone: keep them above it (same floor on every page).
    this.ensureSpace(totalsHeight, this.contentBottom());

    const top = this.y;
    const right = PAGE.width - L.margins.right;
    const blockLeft = right - L.totals.width;
    const leftColWidth = blockLeft - L.margins.left - 16;

    // Totals (right column)
    let ty = top;
    for (const row of rows) {
      const style = row.style ?? "normal";
      if (style === "grand") {
        this.rect(blockLeft, ty - rowH + 1, L.totals.width, rowH, C.purple);
        this.text(row.label, blockLeft + 6, ty - rowH + 5.5, { font: this.bold, size: L.fonts.body, color: C.white });
        this.text(row.value, right - 6, ty - rowH + 5.5, { font: this.bold, size: L.fonts.body, color: C.white, align: "right" });
      } else {
        const font = style === "strong" ? this.bold : this.regular;
        const c = style === "muted" ? C.muted : C.text;
        this.text(row.label, blockLeft + 6, ty - rowH + 5, { font, size: L.fonts.body, color: c });
        this.text(row.value, right - 6, ty - rowH + 5, { font, size: L.fonts.body, color: c, align: "right" });
        this.hline(blockLeft, right, ty - rowH + 1);
      }
      ty -= rowH;
    }

    // Amount in words (left column, level with totals)
    let ly = top;
    if (data.currency === "XAF") {
      this.text("AMOUNT IN WORDS", L.margins.left, ly - 8, { font: this.bold, size: L.fonts.small, color: C.purple });
      const count = this.paragraph(amountInWordsXAF(data.calc.netPayable), L.margins.left, ly - 12, leftColWidth, {
        font: this.italic,
        size: L.fonts.body,
      });
      ly -= 12 + count * this.lineHeight(L.fonts.body) + 10;
    }

    this.y = Math.min(ty, ly) - 12;

    // Free-flow blocks (left column width everywhere so they never run under the stamp)
    const blocks: Array<{ heading: string; body: string }> = [];
    const bankText = this.bankText();
    if (bankText) blocks.push({ heading: "PAYMENT DETAILS", body: bankText });
    if (data.paymentInstructions?.trim()) blocks.push({ heading: "PAYMENT INSTRUCTIONS", body: data.paymentInstructions.trim() });
    if (data.notes?.trim()) blocks.push({ heading: "NOTES", body: data.notes.trim() });
    if (data.terms?.trim()) blocks.push({ heading: "TERMS & CONDITIONS", body: data.terms.trim() });

    const blockWidth = leftColWidth;
    for (const block of blocks) {
      const lines = wrapText(block.body, this.regular, L.fonts.small + 0.5, blockWidth);
      const lh = this.lineHeight(L.fonts.small + 0.5);
      let index = 0;
      let first = true;
      while (index < lines.length) {
        const headingH = first ? 14 : 0;
        // keep at least 2 lines together with the heading
        this.ensureSpace(headingH + lh * Math.min(2, lines.length - index));
        const available = Math.floor((this.y - this.contentBottom() - headingH) / lh);
        const take = Math.max(1, Math.min(lines.length - index, available));
        if (first) {
          this.text(block.heading, L.margins.left, this.y - 8, { font: this.bold, size: L.fonts.small, color: C.purple });
          this.y -= headingH;
        }
        for (let i = 0; i < take; i++) {
          this.text(lines[index + i], L.margins.left, this.y - (i + 1) * lh + 3, { size: L.fonts.small + 0.5 });
        }
        this.y -= take * lh;
        index += take;
        first = false;
      }
      this.y -= 8;
    }

    if (data.verificationUrl) {
      this.ensureSpace(14);
      this.text(`Verify this document: ${data.verificationUrl}`, L.margins.left, this.y - 8, {
        size: L.fonts.tiny,
        color: C.muted,
      });
      this.y -= 14;
    }
  }

  private bankText(): string | null {
    const bank = this.data.bank;
    if (!bank) return null;
    const rows: string[] = [];
    if (bank.bankName?.trim()) rows.push(`Bank: ${bank.bankName.trim()}`);
    if (bank.accountName?.trim()) rows.push(`Account name: ${bank.accountName.trim()}`);
    if (bank.accountNumber?.trim()) rows.push(`Account no.: ${bank.accountNumber.trim()}`);
    if (bank.iban?.trim()) rows.push(`IBAN: ${bank.iban.trim()}`);
    if (bank.swift?.trim()) rows.push(`SWIFT/BIC: ${bank.swift.trim()}`);
    if (bank.mobileMoney?.trim()) rows.push(`Mobile money: ${bank.mobileMoney.trim()}`);
    return rows.length > 0 ? rows.join("\n") : null;
  }

  private drawStamp(rect: ReturnType<typeof getStampRect>) {
    if (!this.stamp) return;
    const angle = STAMP_LAYOUT.rotationDegrees;
    const theta = (angle * Math.PI) / 180;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    // pdf-lib rotates around the bottom-left anchor: shift so the rotation is around the centre.
    const x = cx - ((rect.width / 2) * Math.cos(theta) - (rect.height / 2) * Math.sin(theta));
    const y = cy - ((rect.width / 2) * Math.sin(theta) + (rect.height / 2) * Math.cos(theta));
    this.page.drawImage(this.stamp, {
      x,
      y,
      width: rect.width,
      height: rect.height,
      rotate: degrees(angle),
      opacity: STAMP_LAYOUT.opacity,
    });

    // Authorized signatory, right-aligned directly beneath the stamp.
    const signatory = [this.data.signatory?.name, this.data.signatory?.position]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" - ");
    if (signatory) {
      this.text(signatory, rect.x + rect.width, Math.max(rect.y - 9, 8), {
        size: L.fonts.tiny,
        color: C.muted,
        align: "right",
      });
    }
  }

  // -- page furniture ------------------------------------------------------------

  private drawPageDecorations() {
    const total = this.pages.length;
    const { data } = this;
    const stampRect = this.stamp
      ? getStampRect(this.stamp.width, this.stamp.height, this.options.stampLayout)
      : null;

    this.pages.forEach((page, i) => {
      this.page = page;
      this.text(`Page ${i + 1} of ${total}`, PAGE.width - L.margins.right, 116, {
        size: L.fonts.tiny,
        color: C.muted,
        align: "right",
      });
      this.text(data.number, L.margins.left, 116, { size: L.fonts.tiny, color: C.muted });

      if (this.stamp && stampRect) this.drawStamp(stampRect);

      const watermark =
        data.status === "draft" ? "DRAFT" : data.status === "void" ? "CANCELLED" : null;
      if (watermark) {
        const size = watermark === "CANCELLED" ? 84 : 110;
        const width = this.bold.widthOfTextAtSize(watermark, size);
        // diagonal across the page centre (45 degrees)
        const theta = Math.PI / 4;
        const cx = PAGE.width / 2;
        const cy = PAGE.height / 2;
        page.drawText(watermark, {
          x: cx - (width / 2) * Math.cos(theta) + (size * 0.35) * Math.sin(theta),
          y: cy - (width / 2) * Math.sin(theta) - (size * 0.35) * Math.cos(theta),
          size,
          font: this.bold,
          color: color(C.purple),
          opacity: 0.08,
          rotate: degrees(45),
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a document to PDF bytes.
 *
 * @throws if the letterhead PDF cannot be parsed. A broken stamp PNG also throws (never silently
 *         ship an unstamped "issued" document).
 */
export async function renderDocumentPdf(
  data: PdfDocumentData,
  assets: PdfRenderAssets,
  options: PdfRenderOptions = {},
): Promise<Uint8Array> {
  const builder = await PdfBuilder.create(data, assets, options);
  const now = options.now ?? new Date();

  builder.pdf.setTitle(`${TITLES[data.type]} ${data.number}`);
  builder.pdf.setSubject(`${TITLES[data.type]} for ${data.customer.name}`);
  builder.pdf.setAuthor(data.issuer.name);
  builder.pdf.setProducer("Promptstack Invoicing");
  builder.pdf.setCreator("Promptstack Invoicing");
  builder.pdf.setCreationDate(now);
  builder.pdf.setModificationDate(now);

  return builder.render();
}
