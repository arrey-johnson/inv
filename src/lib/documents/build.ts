import {
  calculateDocument,
  type CalcDocumentResult,
  type CalcLineInput,
} from "@/lib/finance/calculate-document";
import { D, sumDecimals, toDecimal, type CurrencyCode } from "@/lib/finance/money";
import type { DocumentBundle, DraftWrite } from "@/lib/data/types";
import type {
  ApprovalStatus,
  DiscountType,
  DocumentItem,
  DocumentRow,
  TaxCategory,
  TaxRate,
  WithholdingBase,
  WithholdingType,
  DocumentWithholding,
} from "@/types/database";
import type { DocumentInput } from "./schema";
import { isReceivableType, type SalesDocumentType } from "./status";

type SalesDocumentTypeValue = SalesDocumentType;

/**
 * A document after the server has resolved every tax rate. This is the only shape the money
 * pipeline works with, whether it came from the editor (new input) or from stored rows (issue-time
 * recalculation, duplicate, convert).
 */
export interface ResolvedLine {
  itemId: string | null;
  description: string;
  details: string | null;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxRateId: string | null;
  taxRate: number;
  taxCategory: TaxCategory;
  /** Credit notes only: the invoice line this line credits. */
  creditSourceItemId?: string | null;
}

/** A withholding applied to a document, with the rate resolved server-side from the configured type. */
export interface ResolvedWithholding {
  typeId: string | null;
  code: string;
  name: string;
  rate: number;
  base: WithholdingBase;
}

export interface ResolvedDocument {
  documentType: SalesDocumentTypeValue;
  customerId: string;
  issueDate: string;
  dueDate: string | null;
  validUntil: string | null;
  currency: CurrencyCode;
  reference: string | null;
  subject: string | null;
  notes: string | null;
  terms: string | null;
  internalNotes: string | null;
  globalDiscountType: DiscountType;
  globalDiscountValue: string;
  lines: ResolvedLine[];
  withholdings: ResolvedWithholding[];
}

export class DocumentBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentBuildError";
  }
}

/**
 * Resolve tax rates from the database (never trust a rate sent by the browser). When VAT is
 * disabled for the organization every line is 0% / exempt.
 */
export function resolveDocumentInput(
  input: DocumentInput,
  taxRates: ReadonlyArray<TaxRate>,
  options: { vatEnabled: boolean; withholdingTypes?: ReadonlyArray<WithholdingType> },
): ResolvedDocument {
  const byId = new Map(taxRates.map((r) => [r.id, r]));
  const lines = input.lines.map((line, index): ResolvedLine => {
    let taxRateId: string | null = null;
    let taxRate = 0;
    let taxCategory: TaxCategory = "exempt";
    if (options.vatEnabled && line.taxRateId) {
      const rate = byId.get(line.taxRateId);
      if (!rate || !rate.is_active) {
        throw new DocumentBuildError(`Line ${index + 1}: the selected tax rate is not available. Pick another one.`);
      }
      taxRateId = rate.id;
      taxRate = rate.rate;
      taxCategory = rate.category;
    }
    return {
      itemId: line.itemId,
      description: line.description,
      details: line.details,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountType: line.discountType,
      discountValue: line.discountValue,
      taxRateId,
      taxRate,
      taxCategory,
    };
  });

  const typesById = new Map((options.withholdingTypes ?? []).map((t) => [t.id, t]));
  const withholdings = [...new Set(input.withholdingTypeIds ?? [])].map((id): ResolvedWithholding => {
    const type = typesById.get(id);
    if (!type || !type.is_active) {
      throw new DocumentBuildError("The selected withholding type is not available. Pick another one or remove it.");
    }
    return { typeId: type.id, code: type.code, name: type.name, rate: type.rate, base: type.base };
  });

  return {
    documentType: input.documentType,
    customerId: input.customerId,
    issueDate: input.issueDate,
    dueDate: isReceivableType(input.documentType) ? input.dueDate : null,
    validUntil: input.documentType === "proforma" ? input.validUntil : null,
    currency: input.currency,
    reference: input.reference,
    subject: input.subject,
    notes: input.notes,
    terms: input.terms,
    internalNotes: input.internalNotes,
    globalDiscountType: input.globalDiscountType,
    globalDiscountValue: input.globalDiscountValue,
    lines,
    withholdings,
  };
}

/** Rebuild the resolved document from stored rows (stored tax rates are authoritative). */
export function resolvedFromBundle(
  bundle: Pick<DocumentBundle, "document" | "items"> & { withholdings?: ReadonlyArray<DocumentWithholding> },
): ResolvedDocument {
  const doc = bundle.document;
  return {
    documentType: doc.document_type as SalesDocumentTypeValue,
    customerId: doc.customer_id,
    issueDate: doc.issue_date,
    dueDate: doc.due_date,
    validUntil: doc.valid_until,
    currency: doc.currency,
    reference: doc.reference,
    subject: doc.subject,
    notes: doc.notes,
    terms: doc.terms,
    internalNotes: doc.internal_notes,
    globalDiscountType: doc.global_discount_type,
    globalDiscountValue: String(doc.global_discount_value),
    lines: [...bundle.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        itemId: item.item_id,
        description: item.description,
        details: item.details,
        quantity: String(item.quantity),
        unit: item.unit,
        unitPrice: String(item.unit_price),
        discountType: item.discount_type,
        discountValue: String(item.discount_value),
        taxRateId: item.tax_rate_id,
        taxRate: item.tax_rate,
        taxCategory: item.tax_category,
        creditSourceItemId: item.credit_source_item_id ?? null,
      })),
    withholdings: (bundle.withholdings ?? []).map((w) => ({
      typeId: w.withholding_type_id,
      code: w.code,
      name: w.name,
      rate: w.rate,
      base: w.base,
    })),
  };
}

/** Run the single finance engine over a resolved document. Throws `FinanceCalculationError`. */
export function computeResolved(doc: ResolvedDocument): CalcDocumentResult {
  const lines: CalcLineInput[] = doc.lines.map((line, index) => ({
    id: String(index),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountType: line.discountType,
    discountValue: line.discountValue,
    taxRate: line.taxRate,
  }));
  return calculateDocument({
    currency: doc.currency,
    lines,
    globalDiscountType: doc.globalDiscountType,
    globalDiscountValue: doc.globalDiscountValue,
    withholdings: doc.withholdings.map((w) => ({ code: w.code, rate: w.rate, base: w.base })),
  });
}

export interface BuildWriteOptions {
  convertedFromDocumentId?: string | null;
  /** Carry approval metadata over (issue-time rewrite). Editing a draft resets it. */
  approval?: Pick<
    DocumentRow,
    "approval_status" | "approval_requested_by" | "approval_requested_at" | "approved_by" | "approved_at" | "approval_note"
  > | null;
}

const NO_APPROVAL = {
  approval_status: "none" as ApprovalStatus,
  approval_requested_by: null,
  approval_requested_at: null,
  approved_by: null,
  approved_at: null,
  approval_note: null,
};

/** Translate a resolved document + its calculation into rows. Never contains a number or status. */
export function buildDraftWrite(doc: ResolvedDocument, calc: CalcDocumentResult, options: BuildWriteOptions = {}): DraftWrite {
  return {
    document: {
      document_type: doc.documentType,
      customer_id: doc.customerId,
      issue_date: doc.issueDate,
      due_date: doc.dueDate,
      valid_until: doc.validUntil,
      currency: doc.currency,
      reference: doc.reference,
      subject: doc.subject,
      notes: doc.notes,
      terms: doc.terms,
      internal_notes: doc.internalNotes,
      global_discount_type: doc.globalDiscountType,
      global_discount_value: toDecimal(doc.globalDiscountValue).toNumber(),
      subtotal: calc.subtotal,
      line_discount_total: calc.lineDiscountTotal,
      global_discount_amount: calc.globalDiscountAmount,
      net_ht: calc.netHT,
      tax_total: calc.taxTotal,
      total_ttc: calc.totalTTC,
      withholding_total: calc.withholdingTotal,
      net_payable: calc.netPayable,
      balance_due: 0,
      converted_from_document_id: options.convertedFromDocumentId ?? null,
      ...(options.approval ?? NO_APPROVAL),
    },
    items: doc.lines.map((line, index) => {
      const result = calc.lines[index];
      return {
        position: index + 1,
        item_id: line.itemId,
        description: line.description,
        details: line.details,
        quantity: toDecimal(line.quantity).toNumber(),
        unit: line.unit,
        unit_price: toDecimal(line.unitPrice).toNumber(),
        discount_type: line.discountType,
        discount_value: toDecimal(line.discountValue).toNumber(),
        tax_rate_id: line.taxRateId,
        tax_rate: line.taxRate,
        tax_category: line.taxCategory,
        gross_amount: result.grossAmount,
        discount_amount: result.discountAmount,
        net_amount: result.netAmount,
        global_discount_share: result.globalDiscountShare,
        taxable_amount: result.taxableAmount,
        tax_amount: result.taxAmount,
        total_amount: result.totalAmount,
        credit_source_item_id: line.creditSourceItemId ?? null,
      };
    }),
    withholdings: doc.withholdings.map((w, index) => ({
      withholding_type_id: w.typeId,
      code: w.code,
      name: w.name,
      rate: w.rate,
      base: w.base,
      base_amount: calc.withholdings[index].baseAmount,
      amount: calc.withholdings[index].amount,
    })),
  };
}

/** Do the stored totals (header and every line) equal a fresh calculation? Exact decimal comparison. */
export function storedTotalsMatch(document: DocumentRow, items: ReadonlyArray<DocumentItem>, calc: CalcDocumentResult): boolean {
  const same = (a: number, b: number) => new D(a).equals(b);
  if (
    !same(document.subtotal, calc.subtotal) ||
    !same(document.line_discount_total, calc.lineDiscountTotal) ||
    !same(document.global_discount_amount, calc.globalDiscountAmount) ||
    !same(document.net_ht, calc.netHT) ||
    !same(document.tax_total, calc.taxTotal) ||
    !same(document.total_ttc, calc.totalTTC) ||
    !same(document.withholding_total, calc.withholdingTotal) ||
    !same(document.net_payable, calc.netPayable)
  ) {
    return false;
  }
  const sorted = [...items].sort((a, b) => a.position - b.position);
  if (sorted.length !== calc.lines.length) return false;
  if (!sumDecimals(sorted.map((i) => i.total_amount)).equals(calc.totalTTC)) return false;
  return sorted.every(
    (item, i) =>
      same(item.net_amount, calc.lines[i].netAmount) &&
      same(item.taxable_amount, calc.lines[i].taxableAmount) &&
      same(item.tax_amount, calc.lines[i].taxAmount) &&
      same(item.total_amount, calc.lines[i].totalAmount),
  );
}
