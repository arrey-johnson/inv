import {
  calculateDocument,
  FinanceCalculationError,
  type CalcDocumentResult,
  type CalcLineInput,
  type CalcLineResult,
} from "@/lib/finance/calculate-document";
import type { CurrencyCode } from "@/lib/finance/money";
import type { DocumentBundle } from "@/lib/data/types";
import { addDaysISO, daysBetweenISO, isValidISODate } from "@/lib/utils/date-math";
import { parseDecimalText } from "@/lib/validations/common";
import type { DiscountType, WithholdingBase } from "@/types/database";
import type { DocumentInputRaw } from "./schema";
import { isReceivableType, type BuilderDocumentType } from "./status";

/**
 * Client-side model of the document editor. Everything is text (what the user typed); money maths
 * happens in the shared `calculateDocument` engine. This is a PREVIEW - the server recomputes the
 * same numbers from the stored lines before saving or issuing.
 */
export interface BuilderLine {
  /** Stable React key (not persisted). */
  key: string;
  itemId: string | null;
  description: string;
  details: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxRateId: string | null;
}

export interface BuilderState {
  customerId: string;
  issueDate: string;
  paymentTermsDays: string;
  dueDate: string;
  validUntil: string;
  currency: CurrencyCode;
  reference: string;
  subject: string;
  notes: string;
  terms: string;
  internalNotes: string;
  globalDiscountType: DiscountType;
  globalDiscountValue: string;
  /** Configured withholding types applied to this document (rates are resolved server-side). */
  withholdingTypeIds: string[];
  lines: BuilderLine[];
}

export interface BuilderWithholdingType {
  id: string;
  code: string;
  name: string;
  rate: number;
  base: WithholdingBase;
  is_active: boolean;
}

export interface BuilderTaxRate {
  id: string;
  name: string;
  rate: number;
  category: string;
  is_active: boolean;
}

let lineSeq = 0;
export function newLineKey(): string {
  lineSeq += 1;
  // Random part keeps keys from server-built lines distinct from lines added later in the browser.
  return `line-${Math.random().toString(36).slice(2, 8)}-${lineSeq}`;
}

export function emptyLine(taxRateId: string | null, unit = ""): BuilderLine {
  return {
    key: newLineKey(),
    itemId: null,
    description: "",
    details: "",
    quantity: "1",
    unit,
    unitPrice: "",
    discountType: "none",
    discountValue: "0",
    taxRateId,
  };
}

/** Due date = issue date + payment terms (null while either is not a valid number/date). */
export function dueDateFromTerms(issueDate: string, termsDays: string): string | null {
  const days = Number(termsDays);
  if (!isValidISODate(issueDate) || !Number.isInteger(days) || days < 0 || days > 365) return null;
  return addDaysISO(issueDate, days);
}

/** The payload sent to the server action; the server validates it again with `documentInputSchema`. */
export function toDocumentPayload(documentType: BuilderDocumentType, state: BuilderState): DocumentInputRaw {
  return {
    documentType,
    customerId: state.customerId,
    issueDate: state.issueDate,
    dueDate: isReceivableType(documentType) && state.dueDate ? state.dueDate : null,
    validUntil: documentType === "proforma" && state.validUntil ? state.validUntil : null,
    currency: state.currency,
    reference: state.reference,
    subject: state.subject,
    notes: state.notes,
    terms: state.terms,
    internalNotes: state.internalNotes,
    globalDiscountType: state.globalDiscountType,
    globalDiscountValue: state.globalDiscountValue,
    withholdingTypeIds: state.withholdingTypeIds,
    lines: state.lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      details: line.details,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountType: line.discountType,
      discountValue: line.discountValue,
      taxRateId: line.taxRateId,
    })),
  };
}

export interface BuilderTotals {
  calc: CalcDocumentResult | null;
  /** Per editor line: its computed result, or null while the line is incomplete. */
  lineResults: Array<CalcLineResult | null>;
  /** 1-based numbers of lines that are excluded from the preview because a number is invalid. */
  incompleteLines: number[];
  error: string | null;
}

/** Live totals for the editor, using the one shared finance engine. */
export function computeBuilderTotals(
  state: Pick<BuilderState, "currency" | "lines" | "globalDiscountType" | "globalDiscountValue"> & { withholdingTypeIds?: string[] },
  taxRates: ReadonlyArray<BuilderTaxRate>,
  vatEnabled: boolean,
  withholdingTypes: ReadonlyArray<BuilderWithholdingType> = [],
): BuilderTotals {
  const rateById = new Map(taxRates.map((r) => [r.id, r]));
  const inputs: CalcLineInput[] = [];
  const editorIndexOf: number[] = [];
  const incompleteLines: number[] = [];

  state.lines.forEach((line, index) => {
    const quantity = parseDecimalText(line.quantity);
    const price = parseDecimalText(line.unitPrice === "" ? "0" : line.unitPrice);
    const discount = parseDecimalText(line.discountValue === "" ? "0" : line.discountValue);
    if (quantity === null || Number(quantity) <= 0 || price === null || discount === null) {
      incompleteLines.push(index + 1);
      return;
    }
    const rate = vatEnabled && line.taxRateId ? (rateById.get(line.taxRateId)?.rate ?? 0) : 0;
    inputs.push({
      id: line.key,
      quantity,
      unitPrice: price,
      discountType: line.discountType,
      discountValue: discount,
      taxRate: rate,
    });
    editorIndexOf.push(index);
  });

  const empty: BuilderTotals = { calc: null, lineResults: state.lines.map(() => null), incompleteLines, error: null };
  if (inputs.length === 0) return empty;

  const globalValue = parseDecimalText(state.globalDiscountValue === "" ? "0" : state.globalDiscountValue);
  if (globalValue === null) return { ...empty, error: "The global discount is not a valid number." };

  try {
    const calc = calculateDocument({
      currency: state.currency,
      lines: inputs,
      globalDiscountType: state.globalDiscountType,
      globalDiscountValue: globalValue,
      withholdings: (state.withholdingTypeIds ?? [])
        .map((id) => withholdingTypes.find((t) => t.id === id))
        .filter((t): t is BuilderWithholdingType => Boolean(t))
        .map((t) => ({ code: t.code, rate: t.rate, base: t.base })),
    });
    const lineResults: Array<CalcLineResult | null> = state.lines.map(() => null);
    calc.lines.forEach((result, i) => {
      lineResults[editorIndexOf[i]] = result;
    });
    return { calc, lineResults, incompleteLines, error: null };
  } catch (cause) {
    if (cause instanceof FinanceCalculationError) return { ...empty, error: cause.message };
    throw cause;
  }
}

/** A blank editor for a new document. */
export function newBuilderState(input: {
  documentType: BuilderDocumentType;
  today: string;
  currency: CurrencyCode;
  paymentTermsDays: number;
  validityDays: number;
  notes: string | null;
  terms: string | null;
  customerId?: string;
  withholdingTypeIds?: string[];
}): BuilderState {
  return {
    customerId: input.customerId ?? "",
    issueDate: input.today,
    paymentTermsDays: String(input.paymentTermsDays),
    dueDate: isReceivableType(input.documentType) ? addDaysISO(input.today, input.paymentTermsDays) : "",
    validUntil: input.documentType === "proforma" ? addDaysISO(input.today, input.validityDays) : "",
    currency: input.currency,
    reference: "",
    subject: "",
    notes: input.notes ?? "",
    terms: input.terms ?? "",
    internalNotes: "",
    globalDiscountType: "none",
    globalDiscountValue: "0",
    withholdingTypeIds: input.withholdingTypeIds ?? [],
    lines: [],
  };
}

/** Editor state for an existing (draft) document. */
export function builderStateFromBundle(bundle: Pick<DocumentBundle, "document" | "items"> & Partial<Pick<DocumentBundle, "withholdings">>, fallbackTermsDays: number): BuilderState {
  const doc = bundle.document;
  const terms =
    doc.due_date && isValidISODate(doc.due_date) && isValidISODate(doc.issue_date)
      ? Math.max(0, daysBetweenISO(doc.issue_date, doc.due_date))
      : fallbackTermsDays;
  return {
    customerId: doc.customer_id,
    issueDate: doc.issue_date,
    paymentTermsDays: String(terms),
    dueDate: doc.due_date ?? "",
    validUntil: doc.valid_until ?? "",
    currency: doc.currency,
    reference: doc.reference ?? "",
    subject: doc.subject ?? "",
    notes: doc.notes ?? "",
    terms: doc.terms ?? "",
    internalNotes: doc.internal_notes ?? "",
    globalDiscountType: doc.global_discount_type,
    globalDiscountValue: String(doc.global_discount_value),
    withholdingTypeIds: (bundle.withholdings ?? []).map((w) => w.withholding_type_id).filter((id): id is string => Boolean(id)),
    lines: [...bundle.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        key: newLineKey(),
        itemId: item.item_id,
        description: item.description,
        details: item.details ?? "",
        quantity: String(item.quantity),
        unit: item.unit ?? "",
        unitPrice: String(item.unit_price),
        discountType: item.discount_type,
        discountValue: String(item.discount_value),
        taxRateId: item.tax_rate_id,
      })),
  };
}