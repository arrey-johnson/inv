/**
 * Customer statement PDF on the official letterhead (same overlay approach as documents: the letterhead PDF
 * is the background of every page, content stays inside the safe area). No stamp: a statement is an account
 * summary, not a legal document. Money is printed from the statement; nothing is recomputed here.
 */
import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney, formatNumber } from "@/lib/finance/format";
import { formatDate } from "@/lib/utils/dates";
import { DOCUMENT_LAYOUT, PAGE } from "@/lib/pdf/layout";
import { sanitize, wrapText } from "@/lib/pdf/document-pdf-renderer";
import type { PdfParty } from "@/lib/pdf/types";
import type { CustomerStatement } from "./build-statement";

const L = DOCUMENT_LAYOUT;
const C = L.colors;
type Rgb = { r: number; g: number; b: number };
const color = (c: Rgb) => rgb(c.r, c.g, c.b);

export interface StatementPdfData {
  statement: CustomerStatement;
  customer: PdfParty;
  issuer: PdfParty;
  generatedOn: string;
}

const COLS = { date: 54, ref: 82, debit: 60, credit: 60, balance: 66 };

class StatementBuilder {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private letterhead!: PDFEmbeddedPage;

  constructor(
    readonly pdf: PDFDocument,
    private readonly data: StatementPdfData,
  ) {}

  async init(letterheadPdf: Uint8Array) {
    this.regular = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    [this.letterhead] = await this.pdf.embedPdf(letterheadPdf, [0]);
  }

  private addPage() {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    page.drawPage(this.letterhead, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });
    this.pages.push(page);
    this.page = page;
    this.y = L.safeArea.firstPageTop;
  }

  private text(value: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: Rgb; align?: "left" | "right" } = {}) {
    const font = o.font ?? this.regular;
    const size = o.size ?? L.fonts.body;
    const safe = sanitize(value, font).replace(/\n/g, " ");
    const width = font.widthOfTextAtSize(safe, size);
    this.page.drawText(safe, { x: o.align === "right" ? x - width : x, y, font, size, color: color(o.color ?? C.text) });
  }

  private hline(y: number, c: Rgb = C.rule) {
    this.page.drawLine({ start: { x: L.margins.left, y }, end: { x: PAGE.width - L.margins.right, y }, thickness: 0.5, color: color(c) });
  }

  private columns() {
    const left = L.margins.left;
    const right = PAGE.width - L.margins.right;
    const descWidth = L.contentWidth - COLS.date - COLS.ref - COLS.debit - COLS.credit - COLS.balance;
    const date = left;
    const ref = date + COLS.date;
    const desc = ref + COLS.ref;
    const debit = desc + descWidth;
    const credit = debit + COLS.debit;
    const balance = credit + COLS.credit;
    return { date, ref, desc, descWidth, debit, credit, balance, right };
  }

  private tableHeader() {
    const x = this.columns();
    const h = 18;
    this.page.drawRectangle({ x: x.date, y: this.y - h, width: L.contentWidth, height: h, color: color(C.tint) });
    const base = this.y - 12.5;
    const o = { font: this.bold, size: L.fonts.small };
    this.text("Date", x.date + 4, base, o);
    this.text("Reference", x.ref + 2, base, o);
    this.text("Description", x.desc + 2, base, o);
    this.text("Debit", x.credit - 4, base, { ...o, align: "right" });
    this.text("Credit", x.balance - 4, base, { ...o, align: "right" });
    this.text("Balance", x.right - 4, base, { ...o, align: "right" });
    this.y -= h;
  }

  async render(): Promise<Uint8Array> {
    const { statement, customer, issuer } = this.data;
    const money = (v: number) => formatMoney(v, statement.currency);
    const num = (v: number) => formatNumber(v, statement.currency);
    this.addPage();
    const left = L.margins.left;
    const right = PAGE.width - L.margins.right;

    this.text("CUSTOMER STATEMENT", left, this.y - 6, { font: this.bold, size: L.fonts.title, color: C.purple });
    this.text(`${formatDate(statement.from)} to ${formatDate(statement.to)}`, left, this.y - 24, { font: this.bold, size: L.fonts.heading });
    this.text(`Generated on ${formatDate(this.data.generatedOn)}`, right, this.y - 6, { size: L.fonts.small, color: C.muted, align: "right" });
    this.text(`Currency: ${statement.currency}`, right, this.y - 18, { size: L.fonts.small, color: C.muted, align: "right" });
    this.y -= 46;

    // Parties
    const half = L.contentWidth / 2 - 10;
    const partyBlock = (x: number, heading: string, party: PdfParty) => {
      this.text(heading, x, this.y, { font: this.bold, size: L.fonts.small, color: C.purple });
      let y = this.y - 12;
      const lines = [party.name, ...(party.addressLines ?? []), party.niu ? `NIU: ${party.niu}` : null, party.rccm ? `RCCM: ${party.rccm}` : null].filter(
        (l): l is string => Boolean(l && l.trim()),
      );
      lines.forEach((line, i) => {
        for (const wrapped of wrapText(line, i === 0 ? this.bold : this.regular, L.fonts.body, half)) {
          this.text(wrapped, x, y, { font: i === 0 ? this.bold : this.regular });
          y -= L.fonts.body * L.fonts.lineHeightRatio;
        }
      });
      return y;
    };
    const yA = partyBlock(left, "ACCOUNT OF", customer);
    const yB = partyBlock(left + half + 20, "ISSUED BY", issuer);
    this.y = Math.min(yA, yB) - 10;

    // Summary
    this.page.drawRectangle({ x: left, y: this.y - 34, width: L.contentWidth, height: 34, color: color(C.tint) });
    const cell = L.contentWidth / 4;
    const summary: Array<[string, string]> = [
      ["Opening balance", money(statement.openingBalance)],
      ["Invoiced", money(statement.totalDebit)],
      ["Credits and payments", money(statement.totalCredit)],
      ["Closing balance", money(statement.closingBalance)],
    ];
    summary.forEach(([label, value], i) => {
      this.text(label, left + i * cell + 6, this.y - 13, { size: L.fonts.tiny, color: C.muted });
      this.text(value, left + i * cell + 6, this.y - 26, { font: this.bold, size: L.fonts.body, color: i === 3 ? C.purple : C.text });
    });
    this.y -= 48;

    this.tableHeader();
    const x = this.columns();
    const size = L.fonts.small;
    const lh = size * L.fonts.lineHeightRatio;

    const row = (cells: { date: string; ref: string; desc: string; debit: string; credit: string; balance: string }, strong = false) => {
      const font = strong ? this.bold : this.regular;
      const refLines = wrapText(cells.ref, font, size, COLS.ref - 6);
      const descLines = wrapText(cells.desc, font, size, x.descWidth - 6);
      const rows = Math.max(refLines.length, descLines.length, 1);
      const height = rows * lh + 8;
      if (this.y - height < L.safeArea.bottom) {
        this.addPage();
        this.tableHeader();
      }
      const base = this.y - 5 - size;
      this.text(cells.date, x.date + 4, base, { font, size });
      refLines.forEach((line, i) => this.text(line, x.ref + 2, base - i * lh, { font, size }));
      descLines.forEach((line, i) => this.text(line, x.desc + 2, base - i * lh, { font, size, color: strong ? C.text : C.muted }));
      this.text(cells.debit, x.credit - 4, base, { font, size, align: "right" });
      this.text(cells.credit, x.balance - 4, base, { font, size, align: "right" });
      this.text(cells.balance, x.right - 4, base, { font: this.bold, size, align: "right" });
      this.y -= height;
      this.hline(this.y);
    };

    row({ date: formatDate(statement.from), ref: "", desc: "Opening balance", debit: "", credit: "", balance: num(statement.openingBalance) }, true);
    if (statement.entries.length === 0) {
      row({ date: "", ref: "", desc: "No activity in this period.", debit: "", credit: "", balance: "" });
    }
    for (const entry of statement.entries) {
      row({
        date: formatDate(entry.date),
        ref: entry.reference,
        desc: entry.description,
        debit: entry.debit > 0 ? num(entry.debit) : "",
        credit: entry.credit > 0 ? num(entry.credit) : "",
        balance: num(entry.balance),
      });
    }
    row(
      {
        date: formatDate(statement.to),
        ref: "",
        desc: "Closing balance",
        debit: num(statement.totalDebit),
        credit: num(statement.totalCredit),
        balance: num(statement.closingBalance),
      },
      true,
    );

    this.y -= 12;
    const note =
      statement.closingBalance > 0
        ? `Amount due: ${money(statement.closingBalance)}.`
        : statement.closingBalance < 0
          ? `The account is in credit by ${money(-statement.closingBalance)}.`
          : "The account is settled.";
    if (this.y - 40 < L.safeArea.bottom) this.addPage();
    this.text(note, left, this.y, { font: this.bold, size: L.fonts.body });
    this.y -= 14;
    const footnotes = [
      "Debits are the net amounts payable of issued invoices (after any withholding). Credits are payments received, credit notes and advances deducted.",
      "Cancelled documents and cancelled payments are not included.",
      statement.excludedOtherCurrency > 0
        ? `${statement.excludedOtherCurrency} open document(s) in another currency are not part of this statement.`
        : null,
    ].filter((l): l is string => Boolean(l));
    for (const footnote of footnotes) {
      for (const line of wrapText(footnote, this.regular, L.fonts.tiny, L.contentWidth)) {
        if (this.y - 10 < L.safeArea.bottom) this.addPage();
        this.text(line, left, this.y, { size: L.fonts.tiny, color: C.muted });
        this.y -= 9;
      }
    }

    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      this.page = page;
      this.text(`Page ${i + 1} of ${total}`, right, 116, { size: L.fonts.tiny, color: C.muted, align: "right" });
      this.text(`Statement - ${customer.name}`, left, 116, { size: L.fonts.tiny, color: C.muted });
    });
    return this.pdf.save();
  }
}

export async function renderStatementPdf(
  data: StatementPdfData,
  assets: { letterheadPdf: Uint8Array },
  options: { now?: Date } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const builder = new StatementBuilder(pdf, data);
  await builder.init(assets.letterheadPdf);
  const now = options.now ?? new Date();
  pdf.setTitle(`Customer statement - ${data.customer.name}`);
  pdf.setAuthor(data.issuer.name);
  pdf.setProducer("Promptstack Invoicing");
  pdf.setCreator("Promptstack Invoicing");
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  return builder.render();
}
