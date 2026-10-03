import { z } from "zod";
import { DocumentBuildError, type ResolvedDocument, type ResolvedLine } from "@/lib/documents/build";
import { calculateCreditNoteCapacity } from "@/lib/finance/calculate-document";
import { D, roundMoney, sumDecimals, toDecimal, type CurrencyCode, type Dec } from "@/lib/finance/money";
import { isValidISODate } from "@/lib/utils/date-math";
import type { DocumentBundle } from "@/lib/data/types";
import type { DocumentItem, TaxRate } from "@/types/database";

export const CREDIT_MODES = ["full", "lines", "amount"] as const;
export type CreditMode = (typeof CREDIT_MODES)[number];

export const creditNoteInputSchema = z.object({
  invoiceId: z.string().uuid("Choose the invoice to credit."),
  mode: z.enum(CREDIT_MODES),
  reason: z.string().trim().min(5, "Explain why the invoice is credited (at least 5 characters).").max(500),
  issueDate: z
    .string()
    .refine(isValidISODate, "Enter a valid date.")
    .optional()
    .nullable(),
  /** `lines` mode: invoice lines and the quantity credited. */
  lines: z
    .array(
      z.object({
        sourceItemId: z.string().uuid(),
        quantity: z.coerce.number().positive("Quantity must be greater than zero."),
      }),
    )
    .default([]),
  /** `amount` mode: an amount excluding VAT and the rate it carries. */
  amountHt: z.coerce.number().positive("Enter an amount greater than zero.").optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
});
export type CreditNoteInput = z.infer<typeof creditNoteInputSchema>;

/** What of an invoice can still be credited. */
export interface CreditContext {
  invoice: DocumentBundle;
  /** Total TTC of the credit notes already applied. */
  creditedTTC: number;
  remainingTTC: number;
  /** Per invoice line: quantity credited so far and still creditable. */
  lines: Array<{ item: DocumentItem; credited: number; remaining: number }>;
}

/** Sum the credit-note lines already issued against each invoice line. */
export function buildCreditContext(
  invoice: DocumentBundle,
  creditNotes: ReadonlyArray<Pick<DocumentBundle, "document" | "items">>,
): CreditContext {
  const live = creditNotes.filter((n) => n.document.status !== "void" && n.document.status !== "draft");
  const creditedTTC = roundMoney(sumDecimals(live.map((n) => n.document.total_ttc)), invoice.document.currency);
  const capacity = calculateCreditNoteCapacity({
    currency: invoice.document.currency,
    invoiceTotalTTC: invoice.document.total_ttc,
    alreadyCredited: creditedTTC,
    creditNoteTotalTTC: 0,
  });
  const credited = new Map<string, Dec>();
  for (const note of live) {
    for (const item of note.items) {
      if (!item.credit_source_item_id) continue;
      credited.set(item.credit_source_item_id, (credited.get(item.credit_source_item_id) ?? new D(0)).plus(item.quantity));
    }
  }
  return {
    invoice,
    creditedTTC: creditedTTC.toNumber(),
    remainingTTC: capacity.creditableRemaining,
    lines: [...invoice.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => {
        const done = credited.get(item.id) ?? new D(0);
        const left = toDecimal(item.quantity).minus(done);
        return { item, credited: done.toNumber(), remaining: left.greaterThan(0) ? left.toNumber() : 0 };
      }),
  };
}

function lineFrom(item: DocumentItem, quantity: Dec, currency: CurrencyCode): ResolvedLine {
  const full = toDecimal(item.quantity);
  const ratio = quantity.dividedBy(full);
  // A fixed discount is an amount for the whole line, so it follows the credited share of the quantity.
  const discountValue =
    item.discount_type === "fixed" ? roundMoney(toDecimal(item.discount_value).times(ratio), currency).toString() : String(item.discount_value);
  return {
    itemId: item.item_id,
    description: item.description,
    details: item.details,
    quantity: quantity.toString(),
    unit: item.unit,
    unitPrice: String(item.unit_price),
    discountType: item.discount_type,
    discountValue,
    taxRateId: item.tax_rate_id,
    taxRate: item.tax_rate,
    taxCategory: item.tax_category,
    creditSourceItemId: item.id,
  };
}

/**
 * Turn the user's request into a credit note document (lines, discounts and VAT rates derived from the
 * invoice, so HT and VAT are reversed exactly as they were charged). The caller runs it through the
 * finance engine and checks the capacity.
 */
export function buildCreditNoteDocument(
  context: CreditContext,
  input: CreditNoteInput,
  options: { today: string; taxRates: ReadonlyArray<TaxRate>; vatEnabled: boolean },
): ResolvedDocument {
  const { invoice } = context;
  const doc = invoice.document;
  const number = doc.number ?? "the invoice";
  let lines: ResolvedLine[];
  let globalDiscountType = doc.global_discount_type;
  let globalDiscountValue = String(doc.global_discount_value);

  if (input.mode === "full") {
    if (context.creditedTTC > 0) {
      throw new DocumentBuildError(
        "This invoice already has credit notes. Credit the remaining lines or an amount instead of the full invoice.",
      );
    }
    lines = context.lines.map(({ item }) => lineFrom(item, toDecimal(item.quantity), doc.currency));
  } else if (input.mode === "lines") {
    if (input.lines.length === 0) throw new DocumentBuildError("Choose at least one invoice line to credit.");
    const seen = new Set<string>();
    lines = input.lines.map((request, index) => {
      const entry = context.lines.find((l) => l.item.id === request.sourceItemId);
      if (!entry) throw new DocumentBuildError(`Line ${index + 1} does not belong to ${number}.`);
      if (seen.has(entry.item.id)) throw new DocumentBuildError(`"${entry.item.description}" is selected twice.`);
      seen.add(entry.item.id);
      const quantity = toDecimal(request.quantity);
      if (quantity.greaterThan(entry.remaining)) {
        throw new DocumentBuildError(
          `"${entry.item.description}": only ${entry.remaining} can still be credited (invoiced ${entry.item.quantity}, already credited ${entry.credited}).`,
        );
      }
      return lineFrom(entry.item, quantity, doc.currency);
    });
    // Fixed global discount: carry the share that belongs to the credited lines.
    if (doc.global_discount_type === "fixed") {
      const invoiceSubtotal = sumDecimals(context.lines.map((l) => l.item.net_amount));
      const creditedSubtotal = sumDecimals(
        input.lines.map((request) => {
          const entry = context.lines.find((l) => l.item.id === request.sourceItemId)!;
          return toDecimal(entry.item.net_amount).times(request.quantity).dividedBy(entry.item.quantity);
        }),
      );
      globalDiscountValue = invoiceSubtotal.isZero()
        ? "0"
        : roundMoney(toDecimal(doc.global_discount_value).times(creditedSubtotal).dividedBy(invoiceSubtotal), doc.currency).toString();
    }
  } else {
    if (!input.amountHt) throw new DocumentBuildError("Enter the amount to credit (excluding VAT).");
    let taxRate: TaxRate | null = null;
    if (options.vatEnabled) {
      taxRate = options.taxRates.find((r) => r.id === input.taxRateId && r.is_active) ?? null;
      if (!taxRate) throw new DocumentBuildError("Choose the VAT rate that applies to this credit.");
    }
    lines = [
      {
        itemId: null,
        description: `Credit on invoice ${number}`,
        details: input.reason,
        quantity: "1",
        unit: null,
        unitPrice: String(input.amountHt),
        discountType: "none",
        discountValue: "0",
        taxRateId: taxRate?.id ?? null,
        taxRate: taxRate?.rate ?? 0,
        taxCategory: taxRate?.category ?? "exempt",
        creditSourceItemId: null,
      },
    ];
    globalDiscountType = "none";
    globalDiscountValue = "0";
  }

  const issueDate = input.issueDate ?? options.today;
  if (doc.issue_date > issueDate) {
    throw new DocumentBuildError("The credit note cannot be dated before the invoice it credits.");
  }
  return {
    documentType: "credit_note",
    customerId: doc.customer_id,
    issueDate,
    dueDate: null,
    validUntil: null,
    currency: doc.currency,
    reference: doc.number,
    subject: `Credit note for invoice ${number}`,
    notes: input.reason,
    terms: null,
    internalNotes: null,
    globalDiscountType: input.mode === "amount" ? "none" : globalDiscountType,
    globalDiscountValue,
    lines,
    withholdings: [],
  };
}
