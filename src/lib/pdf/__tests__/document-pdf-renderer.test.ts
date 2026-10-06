import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { calculateDocument } from "@/lib/finance/calculate-document";
import { renderDocumentPdf, shouldApplyStamp } from "../document-pdf-renderer";
import { DOCUMENT_LAYOUT, PAGE, getStampRect } from "../layout";
import type { PdfDocumentData, PdfLine } from "../types";

const sourceDir = path.resolve(process.cwd(), "assets/branding/source");
const letterheadPath = path.join(sourceDir, "letterhead-promptstack.pdf");
const stampPath = path.join(sourceDir, "company-stamp.png");
const hasAssets = existsSync(letterheadPath) && existsSync(stampPath);

function buildData(lineCount: number, overrides: Partial<PdfDocumentData> = {}): PdfDocumentData {
  const calcLines = Array.from({ length: lineCount }, (_, i) => ({
    quantity: 1 + (i % 3),
    unitPrice: 50_000 + i * 1_000,
    taxRate: 19.25,
  }));
  const calc = calculateDocument({ lines: calcLines });
  const lines: PdfLine[] = calc.lines.map((l, i) => ({
    description: `Service line ${i + 1} - website maintenance and hosting with a long description that wraps`,
    details: i % 2 === 0 ? "Monthly retainer" : null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxRate: l.taxRate,
    netAmount: l.netAmount,
  }));
  return {
    type: "invoice",
    status: "issued",
    number: "PS-INV-2026-0001",
    issueDate: "2026-10-02",
    dueDate: "2026-11-01",
    currency: "XAF",
    issuer: { name: "Promptstack Technologies" },
    customer: { name: "Acme Cameroun SARL", addressLines: ["Bonanjo", "Douala"], niu: "M000000000000X" },
    lines,
    calc,
    notes: "Thank you for your business.",
    ...overrides,
  };
}

describe("shouldApplyStamp", () => {
  it("stamps issued documents but not drafts or voided documents", () => {
    expect(shouldApplyStamp("issued")).toBe(true);
    expect(shouldApplyStamp("paid")).toBe(true);
    expect(shouldApplyStamp("draft")).toBe(false);
    expect(shouldApplyStamp("void")).toBe(false);
    expect(shouldApplyStamp("draft", true)).toBe(true);
    expect(shouldApplyStamp("issued", false)).toBe(false);
  });
});

describe("layout", () => {
  it("keeps the stamp inside the printable area and above the footer band", () => {
    const rect = getStampRect(552, 452);
    expect(rect.x + rect.width).toBeLessThanOrEqual(PAGE.width - DOCUMENT_LAYOUT.margins.right + 0.001);
    expect(rect.y).toBeGreaterThan(105);
    expect(rect.top).toBeLessThan(DOCUMENT_LAYOUT.safeArea.firstPageTop);
  });

  it("column widths leave room for the description", () => {
    const c = DOCUMENT_LAYOUT.table.columns;
    const fixed = Object.values(c).reduce((a, b) => a + b, 0);
    expect(DOCUMENT_LAYOUT.contentWidth - fixed).toBeGreaterThan(150);
  });
});

describe.skipIf(!hasAssets)("renderDocumentPdf (with official branding assets)", () => {
  const assets = () => ({
    letterheadPdf: readFileSync(letterheadPath),
    stampPng: readFileSync(stampPath),
  });
  const now = new Date("2026-10-02T12:00:00Z");

  it("renders a single-page invoice on the letterhead", async () => {
    const bytes = await renderDocumentPdf(buildData(3), assets(), { now });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(PAGE.width, 1);
    expect(height).toBeCloseTo(PAGE.height, 1);
    expect(doc.getTitle()).toBe("INVOICE PS-INV-2026-0001");
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("paginates long documents and stamps every page", async () => {
    const stamped = await renderDocumentPdf(buildData(45), assets(), { now });
    const unstamped = await renderDocumentPdf(buildData(45), assets(), { now, applyStamp: false });
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    // Stamp image is shared; per-page draw ops still grow the file vs stamp-off.
    expect(stamped.length).toBeGreaterThan(unstamped.length);
  });

  it.skipIf(!process.env.WRITE_SAMPLE_PDF)("writes sample PDFs to .tmp/ for visual inspection", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(".tmp", { recursive: true });
    const calc = calculateDocument({
      lines: [
        { quantity: 1, unitPrice: 1_000_000, taxRate: 19.25 },
        { quantity: 2.5, unitPrice: 40_000, discountType: "percentage", discountValue: 10, taxRate: 19.25 },
      ],
      globalDiscountType: "fixed",
      globalDiscountValue: 50_000,
      withholdings: [{ code: "WHT-5", rate: 5 }],
    });
    const data = buildData(2, {
      calc,
      lines: [
        { description: "Website design and development", details: "Phase 1 - discovery and UI", quantity: 1, unitPrice: 1_000_000, taxRate: 19.25, netAmount: 1_000_000 },
        { description: "Hosting and maintenance (hours)", quantity: 2.5, unit: "h", unitPrice: 40_000, discountLabel: "10%", taxRate: 19.25, netAmount: 90_000 },
      ],
      settlement: { paidAmount: 300_000, balanceDue: calc.netPayable - 300_000 },
      metaRows: [{ label: "Reference", value: "PO-2026-118" }],
      terms: "Payment is due within 30 days of the invoice date.",
    });
    writeFileSync(".tmp/sample-invoice.pdf", await renderDocumentPdf(data, assets(), { now }));
    writeFileSync(".tmp/sample-invoice-multipage.pdf", await renderDocumentPdf(buildData(40), assets(), { now }));
    writeFileSync(".tmp/sample-draft.pdf", await renderDocumentPdf(buildData(3, { status: "draft" }), assets(), { now }));
  });

  it("renders without a stamp for drafts (smaller output)", async () => {
    const stamped = await renderDocumentPdf(buildData(3), assets(), { now });
    const draft = await renderDocumentPdf(buildData(3, { status: "draft" }), assets(), { now });
    expect(draft.length).toBeLessThan(stamped.length);
  });

  it("renders withholding, settlement, bank details and non-WinAnsi text without throwing", async () => {
    const calc = calculateDocument({
      lines: [{ quantity: 1, unitPrice: 1_000_000, taxRate: 19.25 }],
      withholdings: [{ code: "WHT-5", rate: 5 }],
    });
    const data = buildData(1, {
      calc,
      settlement: { paidAmount: 500_000, balanceDue: 642_500 },
      bank: { bankName: "Example Bank", accountNumber: "0000" },
      notes: "Unsupported glyph test: \u4f60\u597d \u2014 d\u00e9j\u00e0 vu \u20ac",
    });
    const bytes = await renderDocumentPdf(data, assets(), { now });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
