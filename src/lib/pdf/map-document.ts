/**
 * Pure mapping from database rows to the renderer's input. No I/O, no recomputation of money:
 * the PDF prints exactly what is stored on the (issued) document.
 */
import type { CalcDocumentResult, CalcLineResult, TaxBreakdownEntry } from "@/lib/finance/calculate-document";
import { D, sumDecimals } from "@/lib/finance/money";
import { formatNumber, formatPercent } from "@/lib/finance/format";
import { isReceivableType } from "@/lib/documents/status";
import type { DocumentItem, DocumentRow, DocumentWithholding, Json } from "@/types/database";
import type { PdfBankDetails, PdfDocumentData, PdfLine, PdfParty } from "./types";

type JsonObject = { [key: string]: Json | undefined };

function asObject(value: Json | null | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function str(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Build a party from a frozen snapshot (issued documents) - never from live customer data. */
export function partyFromSnapshot(snapshot: Json | null | undefined, fallbackName: string): PdfParty {
  const s = asObject(snapshot);
  const cityLine = [str(s.city), str(s.region)].filter(Boolean).join(", ");
  return {
    name: str(s.legal_name) ?? str(s.name) ?? fallbackName,
    addressLines: [str(s.address_line1), str(s.address_line2), cityLine || null, str(s.country)],
    niu: str(s.niu),
    rccm: str(s.rccm),
    phone: str(s.phone),
    email: str(s.email),
  };
}

export function bankFromSnapshot(snapshot: Json | null | undefined): PdfBankDetails | null {
  const s = asObject(snapshot);
  const bank: PdfBankDetails = {
    bankName: str(s.bank_name),
    accountName: str(s.bank_account_name),
    accountNumber: str(s.bank_account_number),
    iban: str(s.bank_iban),
    swift: str(s.bank_swift),
    mobileMoney: str(s.mobile_money_number),
  };
  return Object.values(bank).some(Boolean) ? bank : null;
}

/** Printable payment destinations frozen in the issuer snapshot (bank accounts, mobile money wallets). */
export function destinationsText(snapshot: Json | null | undefined): string | null {
  const raw = asObject(snapshot).payment_destinations;
  if (!Array.isArray(raw)) return null;
  const lines: string[] = [];
  for (const entry of raw) {
    const d = asObject(entry);
    const label = str(d.label);
    if (!label) continue;
    if (d.kind === "mobile_money") {
      const parts = [
        str(d.provider),
        str(d.account_name) ? `Name: ${str(d.account_name)}` : null,
        str(d.account_number) ? `Number: ${str(d.account_number)}` : null,
      ].filter(Boolean);
      lines.push(`Mobile money - ${label}${parts.length ? `: ${parts.join(", ")}` : ""}`);
      continue;
    }
    // Bank: multi-line block for invoices (RIB / Access Bank style).
    lines.push(`Bank: ${str(d.provider) ?? label}`);
    if (str(d.account_name)) lines.push(`Account name: ${str(d.account_name)}`);
    if (str(d.account_number)) lines.push(`Account no.: ${str(d.account_number)}`);
    if (str(d.iban)) lines.push(`IBAN: ${str(d.iban)}`);
    if (str(d.swift)) lines.push(`SWIFT/BIC: ${str(d.swift)}`);
  }
  if (lines.length === 0) return null;
  lines.push("Cheques payable to: Promptstack Technologies");
  return lines.join("\n");
}

export function signatoryFromSnapshot(snapshot: Json | null | undefined): PdfDocumentData["signatory"] {
  const s = asObject(snapshot);
  const name = str(s.signatory_name);
  const position = str(s.signatory_position);
  return name || position ? { name, position } : null;
}

export function discountLabel(item: Pick<DocumentItem, "discount_type" | "discount_value" | "discount_amount">): string | null {
  if (item.discount_type === "none" || item.discount_amount <= 0) return null;
  return item.discount_type === "percentage"
    ? formatPercent(item.discount_value)
    : formatNumber(item.discount_amount);
}

/** Rebuild the calculation result from stored values (grouping VAT by rate, like the engine). */
export function calcFromStored(
  doc: DocumentRow,
  items: ReadonlyArray<DocumentItem>,
  withholdings: ReadonlyArray<DocumentWithholding>,
): CalcDocumentResult {
  const sorted = [...items].sort((a, b) => a.position - b.position);

  const lines: CalcLineResult[] = sorted.map((item, index) => ({
    index,
    id: item.id,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    grossAmount: item.gross_amount,
    discountAmount: item.discount_amount,
    netAmount: item.net_amount,
    globalDiscountShare: item.global_discount_share,
    taxableAmount: item.taxable_amount,
    taxRate: item.tax_rate,
    taxAmount: item.tax_amount,
    totalAmount: item.total_amount,
  }));

  const groups = new Map<number, { taxable: number[]; tax: number[] }>();
  for (const line of lines) {
    const g = groups.get(line.taxRate) ?? { taxable: [], tax: [] };
    g.taxable.push(line.taxableAmount);
    g.tax.push(line.taxAmount);
    groups.set(line.taxRate, g);
  }
  const taxBreakdown: TaxBreakdownEntry[] = [...groups.entries()]
    .map(([rate, g]) => ({
      rate,
      taxableAmount: sumDecimals(g.taxable).toNumber(),
      taxAmount: sumDecimals(g.tax).toNumber(),
    }))
    .sort((a, b) => a.rate - b.rate);

  return {
    currency: doc.currency,
    lines,
    taxBreakdown,
    grossTotal: sumDecimals(lines.map((l) => l.grossAmount)).toNumber(),
    lineDiscountTotal: doc.line_discount_total,
    subtotal: doc.subtotal,
    globalDiscountAmount: doc.global_discount_amount,
    discountTotal: new D(doc.line_discount_total).plus(doc.global_discount_amount).toNumber(),
    netHT: doc.net_ht,
    taxTotal: doc.tax_total,
    totalTTC: doc.total_ttc,
    withholdings: withholdings.map((w) => ({
      code: w.code,
      rate: w.rate,
      base: w.base,
      baseAmount: w.base_amount,
      amount: w.amount,
    })),
    withholdingTotal: doc.withholding_total,
    netPayable: doc.net_payable,
  };
}

export interface BuildPdfDataInput {
  document: DocumentRow;
  items: ReadonlyArray<DocumentItem>;
  withholdings: ReadonlyArray<DocumentWithholding>;
  /** Frozen for issued documents; live values may be passed for draft previews. */
  customer: PdfParty;
  issuer: PdfParty;
  bank?: PdfBankDetails | null;
  /** Issuer snapshot (issued) or a live equivalent (draft): source of payment destinations + signatory. */
  issuerSnapshot?: Json | null;
  metaRows?: PdfDocumentData["metaRows"];
  /** Itemised deductions under the totals (advances, credit notes, payments). */
  settlementRows?: ReadonlyArray<{ label: string; amount: number }>;
  verificationUrl?: string | null;
}

export function buildPdfDocumentData(input: BuildPdfDataInput): PdfDocumentData {
  const { document: doc, items, withholdings } = input;
  const calc = calcFromStored(doc, items, withholdings);
  const paymentInstructions = destinationsText(input.issuerSnapshot);

  const lines: PdfLine[] = [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      description: item.description,
      details: item.details,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price,
      discountLabel: discountLabel(item),
      taxRate: item.tax_rate,
      netAmount: item.net_amount,
    }));

  const metaRows = [...(input.metaRows ?? [])];
  if (doc.reference) {
    // A credit note references the invoice it credits.
    metaRows.unshift({ label: doc.document_type === "credit_note" ? "Credit for invoice" : "Reference", value: doc.reference });
  }
  if (doc.document_type === "proforma" && doc.valid_until) {
    metaRows.unshift({ label: "Valid until", value: doc.valid_until });
  }

  return {
    type: doc.document_type,
    status: doc.status,
    number: doc.number ?? "DRAFT",
    issueDate: doc.issue_date,
    dueDate: isReceivableType(doc.document_type) ? doc.due_date : null,
    currency: doc.currency,
    issuer: input.issuer,
    customer: input.customer,
    metaRows,
    lines,
    calc,
    settlement:
      isReceivableType(doc.document_type) && doc.status !== "draft" && doc.status !== "void"
        ? {
            paidAmount: doc.paid_amount + doc.credited_amount + doc.advance_applied_amount,
            balanceDue: doc.balance_due,
            ...(input.settlementRows && input.settlementRows.length > 0 ? { rows: input.settlementRows } : {}),
          }
        : null,
    notes: doc.notes,
    terms: doc.terms,
    // Configured destinations replace the legacy single-bank fields (never print both).
    bank: paymentInstructions ? null : (input.bank ?? null),
    paymentInstructions,
    signatory: signatoryFromSnapshot(input.issuerSnapshot),
    verificationUrl: input.verificationUrl ?? null,
  };
}
