/**
 * Document calculation engine (invoices, proformas, credit notes, advances / receipts share it).
 *
 * Pipeline (all steps in Decimal, currency-aware rounding at each stored amount):
 *
 *   1. Line gross        = quantity x unit price                         (rounded)
 *   2. Line discount     = percentage of gross | fixed amount (capped)   (rounded)
 *   3. Line net HT       = gross - line discount
 *   4. Subtotal          = sum(line net HT)
 *   5. Global discount   = percentage of subtotal | fixed amount (capped)
 *                          allocated across lines by largest-remainder so allocations sum EXACTLY
 *   6. Taxable amount    = line net HT - allocated global discount
 *   7. Tax BY RATE       = per distinct rate: round(sum(taxable of that rate) x rate / 100)
 *                          (rounded once per rate group - not per line - so totals match the
 *                          printed VAT summary), then distributed back to lines for storage
 *   8. Totals            netHT = sum(taxable), taxTotal = sum(tax groups), totalTTC = netHT + taxTotal
 *   9. Withholding       per withholding type on net HT (default) or on total TTC
 *  10. Net payable       = total TTC - withholding
 *
 * Balance helpers (payments, credit notes, advances) live in the same file so the
 * whole money flow can be unit-tested in one place.
 */
import {
  D,
  DEFAULT_CURRENCY,
  HUNDRED,
  ZERO,
  allocateProportionally,
  maxOfDecimals,
  minOfDecimals,
  percentOf,
  roundMoney,
  sumDecimals,
  toDecimal,
  type CurrencyCode,
  type Dec,
  type DecimalInput,
} from "./money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscountKind = "none" | "percentage" | "fixed";
export type WithholdingBase = "net_ht" | "total_ttc";

export interface CalcLineInput {
  /** Optional caller id (e.g. document_items.id or a client-side key). Echoed back in the result. */
  id?: string;
  quantity: DecimalInput;
  /** Unit price excluding tax. */
  unitPrice: DecimalInput;
  discountType?: DiscountKind;
  /** Percent (0-100) when `percentage`, a currency amount when `fixed`. */
  discountValue?: DecimalInput;
  /** Tax rate in percent, e.g. `19.25`. Use `0` for exempt / zero-rated. */
  taxRate: DecimalInput;
}

export interface WithholdingInput {
  /** Withholding type code, e.g. `"WHT-5"`. */
  code: string;
  /** Rate in percent. */
  rate: DecimalInput;
  /** Base the rate applies to. Defaults to net HT (the usual convention for services). */
  base?: WithholdingBase;
}

export interface CalcDocumentInput {
  currency?: CurrencyCode;
  lines: ReadonlyArray<CalcLineInput>;
  globalDiscountType?: DiscountKind;
  globalDiscountValue?: DecimalInput;
  withholdings?: ReadonlyArray<WithholdingInput>;
}

export interface CalcLineResult {
  index: number;
  id?: string;
  quantity: number;
  unitPrice: number;
  /** quantity x unitPrice */
  grossAmount: number;
  /** Line-level discount */
  discountAmount: number;
  /** gross - line discount (HT, before global discount) */
  netAmount: number;
  /** Share of the global discount allocated to this line */
  globalDiscountShare: number;
  /** netAmount - globalDiscountShare (the tax base of the line) */
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  /** taxableAmount + taxAmount */
  totalAmount: number;
}

export interface TaxBreakdownEntry {
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface WithholdingResult {
  code: string;
  rate: number;
  base: WithholdingBase;
  baseAmount: number;
  amount: number;
}

export interface CalcDocumentResult {
  currency: CurrencyCode;
  lines: CalcLineResult[];
  taxBreakdown: TaxBreakdownEntry[];
  /** Sum of line gross amounts (before any discount). */
  grossTotal: number;
  /** Sum of line-level discounts. */
  lineDiscountTotal: number;
  /** Sum of line net amounts (after line discounts, before global discount). */
  subtotal: number;
  globalDiscountAmount: number;
  /** Total discount = line discounts + global discount. */
  discountTotal: number;
  /** Net amount excluding tax (HT) after every discount. */
  netHT: number;
  taxTotal: number;
  /** Total including tax (TTC). */
  totalTTC: number;
  withholdings: WithholdingResult[];
  withholdingTotal: number;
  /** totalTTC - withholdingTotal: what the customer actually has to pay. */
  netPayable: number;
}

export class FinanceCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceCalculationError";
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function assertPercentage(value: Dec, label: string): void {
  if (value.isNegative() || value.greaterThan(HUNDRED)) {
    throw new FinanceCalculationError(`${label} must be between 0 and 100 (got ${value.toFixed()})`);
  }
}

function computeDiscount(
  kind: DiscountKind | undefined,
  rawValue: DecimalInput | undefined,
  base: Dec,
  currency: CurrencyCode,
  label: string,
): Dec {
  if (!kind || kind === "none") return new D(0);
  const value = toDecimal(rawValue);
  if (value.isNegative()) {
    throw new FinanceCalculationError(`${label} cannot be negative`);
  }
  if (kind === "percentage") {
    assertPercentage(value, `${label} percentage`);
    return roundMoney(percentOf(base, value), currency);
  }
  const fixed = roundMoney(value, currency);
  if (fixed.greaterThan(base)) {
    throw new FinanceCalculationError(
      `${label} (${fixed.toFixed()}) cannot exceed the amount it applies to (${base.toFixed()})`,
    );
  }
  return fixed;
}

const n = (value: Dec): number => value.toNumber();

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function calculateDocument(input: CalcDocumentInput): CalcDocumentResult {
  const currency = input.currency ?? DEFAULT_CURRENCY;

  // ---- 1-3: line level ----------------------------------------------------
  const lineStates = input.lines.map((line, index) => {
    const quantity = toDecimal(line.quantity);
    const unitPrice = toDecimal(line.unitPrice);
    const taxRate = toDecimal(line.taxRate);

    if (quantity.isNegative()) {
      throw new FinanceCalculationError(`Line ${index + 1}: quantity cannot be negative`);
    }
    if (unitPrice.isNegative()) {
      throw new FinanceCalculationError(`Line ${index + 1}: unit price cannot be negative`);
    }
    assertPercentage(taxRate, `Line ${index + 1}: tax rate`);

    const gross = roundMoney(quantity.times(unitPrice), currency);
    const discount = computeDiscount(
      line.discountType,
      line.discountValue,
      gross,
      currency,
      `Line ${index + 1}: discount`,
    );
    const net = gross.minus(discount);
    return { index, id: line.id, quantity, unitPrice, taxRate, gross, discount, net };
  });

  // ---- 4-5: subtotal and global discount ----------------------------------
  const subtotal = sumDecimals(lineStates.map((l) => l.net));
  const globalDiscount = computeDiscount(
    input.globalDiscountType,
    input.globalDiscountValue,
    subtotal,
    currency,
    "Global discount",
  );
  const discountShares = allocateProportionally(
    globalDiscount,
    lineStates.map((l) => l.net),
    currency,
  );

  // ---- 6: taxable per line -------------------------------------------------
  const withTaxable = lineStates.map((l, i) => ({
    ...l,
    globalShare: discountShares[i] ?? new D(0),
    taxable: l.net.minus(discountShares[i] ?? new D(0)),
  }));

  // ---- 7: tax by rate group -------------------------------------------------
  const groups = new Map<string, { rate: Dec; lineIdx: number[] }>();
  for (const l of withTaxable) {
    const key = l.taxRate.toFixed();
    const group = groups.get(key);
    if (group) group.lineIdx.push(l.index);
    else groups.set(key, { rate: l.taxRate, lineIdx: [l.index] });
  }

  const lineTax: Dec[] = withTaxable.map(() => new D(0));
  const taxBreakdown: Array<{ rate: Dec; taxable: Dec; tax: Dec }> = [];
  for (const { rate, lineIdx } of groups.values()) {
    const taxable = sumDecimals(lineIdx.map((i) => withTaxable[i].taxable));
    const tax = roundMoney(percentOf(taxable, rate), currency);
    const shares = allocateProportionally(
      tax,
      lineIdx.map((i) => withTaxable[i].taxable),
      currency,
    );
    lineIdx.forEach((lineIndex, k) => {
      lineTax[lineIndex] = shares[k];
    });
    taxBreakdown.push({ rate, taxable, tax });
  }
  taxBreakdown.sort((a, b) => a.rate.comparedTo(b.rate));

  // ---- 8: totals --------------------------------------------------------------
  const lineDiscountTotal = sumDecimals(lineStates.map((l) => l.discount));
  const grossTotal = sumDecimals(lineStates.map((l) => l.gross));
  const netHT = subtotal.minus(globalDiscount);
  const taxTotal = sumDecimals(taxBreakdown.map((g) => g.tax));
  const totalTTC = netHT.plus(taxTotal);

  // ---- 9-10: withholding ---------------------------------------------------------
  const withholdings: WithholdingResult[] = (input.withholdings ?? []).map((w) => {
    const rate = toDecimal(w.rate);
    assertPercentage(rate, `Withholding ${w.code} rate`);
    const base: WithholdingBase = w.base ?? "net_ht";
    const baseAmount = base === "net_ht" ? netHT : totalTTC;
    const amount = roundMoney(percentOf(baseAmount, rate), currency);
    return { code: w.code, rate: n(rate), base, baseAmount: n(baseAmount), amount: n(amount) };
  });
  const withholdingTotal = sumDecimals(withholdings.map((w) => w.amount));
  if (withholdingTotal.greaterThan(totalTTC)) {
    throw new FinanceCalculationError("Total withholding cannot exceed the document total");
  }
  const netPayable = totalTTC.minus(withholdingTotal);

  const lines: CalcLineResult[] = withTaxable.map((l) => ({
    index: l.index,
    id: l.id,
    quantity: n(l.quantity),
    unitPrice: n(l.unitPrice),
    grossAmount: n(l.gross),
    discountAmount: n(l.discount),
    netAmount: n(l.net),
    globalDiscountShare: n(l.globalShare),
    taxableAmount: n(l.taxable),
    taxRate: n(l.taxRate),
    taxAmount: n(lineTax[l.index]),
    totalAmount: n(l.taxable.plus(lineTax[l.index])),
  }));

  return {
    currency,
    lines,
    taxBreakdown: taxBreakdown.map((g) => ({
      rate: n(g.rate),
      taxableAmount: n(g.taxable),
      taxAmount: n(g.tax),
    })),
    grossTotal: n(grossTotal),
    lineDiscountTotal: n(lineDiscountTotal),
    subtotal: n(subtotal),
    globalDiscountAmount: n(globalDiscount),
    discountTotal: n(lineDiscountTotal.plus(globalDiscount)),
    netHT: n(netHT),
    taxTotal: n(taxTotal),
    totalTTC: n(totalTTC),
    withholdings,
    withholdingTotal: n(withholdingTotal),
    netPayable: n(netPayable),
  };
}

// ---------------------------------------------------------------------------
// Balance, payments, credit notes, advances
// ---------------------------------------------------------------------------

export type SettlementStatus = "unpaid" | "partially_paid" | "paid" | "overpaid";

export interface BalanceInput {
  currency?: CurrencyCode;
  /** The amount the customer owes: `netPayable` from `calculateDocument` (TTC less withholding). */
  netPayable: DecimalInput;
  /** Amounts of payment allocations applied to this document. */
  payments?: ReadonlyArray<DecimalInput>;
  /** Credit note amounts (TTC) applied to this document. */
  creditNotes?: ReadonlyArray<DecimalInput>;
  /** Advance / deposit amounts applied to this document. */
  advances?: ReadonlyArray<DecimalInput>;
}

export interface BalanceResult {
  netPayable: number;
  paidAmount: number;
  creditedAmount: number;
  advanceAppliedAmount: number;
  /** payments + credit notes + advances */
  settledAmount: number;
  /** Never negative. */
  balanceDue: number;
  /** Amount settled beyond what was due (candidate for refund / customer credit). */
  overpaidAmount: number;
  status: SettlementStatus;
}

export function calculateBalance(input: BalanceInput): BalanceResult {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const netPayable = roundMoney(input.netPayable, currency);
  const paid = roundMoney(sumDecimals(input.payments ?? []), currency);
  const credited = roundMoney(sumDecimals(input.creditNotes ?? []), currency);
  const advances = roundMoney(sumDecimals(input.advances ?? []), currency);
  const settled = paid.plus(credited).plus(advances);
  const raw = netPayable.minus(settled);
  const balanceDue = maxOfDecimals(raw, ZERO);
  const overpaid = maxOfDecimals(raw.negated(), ZERO);

  let status: SettlementStatus;
  if (overpaid.greaterThan(0)) status = "overpaid";
  else if (balanceDue.isZero()) status = "paid";
  else if (settled.greaterThan(0)) status = "partially_paid";
  else status = "unpaid";

  return {
    netPayable: n(netPayable),
    paidAmount: n(paid),
    creditedAmount: n(credited),
    advanceAppliedAmount: n(advances),
    settledAmount: n(settled),
    balanceDue: n(balanceDue),
    overpaidAmount: n(overpaid),
    status,
  };
}

export interface CreditNoteCapacityInput {
  currency?: CurrencyCode;
  /** Total TTC of the original invoice. */
  invoiceTotalTTC: DecimalInput;
  /** Sum of other (issued) credit notes already linked to the invoice. */
  alreadyCredited?: DecimalInput;
  /** TTC of the credit note being created / validated. */
  creditNoteTotalTTC: DecimalInput;
}

export interface CreditNoteCapacityResult {
  /** How much can still be credited before this credit note. */
  creditableRemaining: number;
  /** Whether the new credit note fits in the remaining capacity. */
  isValid: boolean;
  /** Remaining capacity after the new credit note (never negative). */
  remainingAfter: number;
  /** Amount by which the credit note exceeds the capacity (0 when valid). */
  excess: number;
}

/** A credit note can never reduce an invoice below zero: validate against remaining capacity. */
export function calculateCreditNoteCapacity(
  input: CreditNoteCapacityInput,
): CreditNoteCapacityResult {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const total = roundMoney(input.invoiceTotalTTC, currency);
  const credited = roundMoney(input.alreadyCredited ?? 0, currency);
  const note = roundMoney(input.creditNoteTotalTTC, currency);
  const remaining = maxOfDecimals(total.minus(credited), ZERO);
  const excess = maxOfDecimals(note.minus(remaining), ZERO);
  return {
    creditableRemaining: n(remaining),
    isValid: excess.isZero(),
    remainingAfter: n(maxOfDecimals(remaining.minus(note), ZERO)),
    excess: n(excess),
  };
}

export interface AdvanceBalanceInput {
  currency?: CurrencyCode;
  /** Amount of the advance (deposit) document / payment received. */
  advanceAmount: DecimalInput;
  /** Amounts already applied to final invoices. */
  applied?: ReadonlyArray<DecimalInput>;
  /** Amounts refunded back to the customer. */
  refunded?: ReadonlyArray<DecimalInput>;
}

export interface AdvanceBalanceResult {
  advanceAmount: number;
  appliedAmount: number;
  refundedAmount: number;
  /** Still available to apply to an invoice (never negative). */
  remaining: number;
  /** True when applications + refunds exceed the advance (data integrity problem). */
  isOverConsumed: boolean;
  status: "unused" | "partially_applied" | "fully_applied";
}

export function calculateAdvanceBalance(input: AdvanceBalanceInput): AdvanceBalanceResult {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const advance = roundMoney(input.advanceAmount, currency);
  const applied = roundMoney(sumDecimals(input.applied ?? []), currency);
  const refunded = roundMoney(sumDecimals(input.refunded ?? []), currency);
  const consumed = applied.plus(refunded);
  const raw = advance.minus(consumed);
  const remaining = maxOfDecimals(raw, ZERO);
  let status: AdvanceBalanceResult["status"];
  if (consumed.isZero()) status = "unused";
  else if (remaining.isZero()) status = "fully_applied";
  else status = "partially_applied";
  return {
    advanceAmount: n(advance),
    appliedAmount: n(applied),
    refundedAmount: n(refunded),
    remaining: n(remaining),
    isOverConsumed: raw.isNegative(),
    status,
  };
}

/**
 * How much of an advance can be applied to an invoice: limited by both what remains on the
 * advance and what the invoice still owes.
 */
export function maxAdvanceApplicable(
  advanceRemaining: DecimalInput,
  invoiceBalanceDue: DecimalInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): number {
  return n(
    roundMoney(
      minOfDecimals(toDecimal(advanceRemaining), toDecimal(invoiceBalanceDue)),
      currency,
    ),
  );
}
