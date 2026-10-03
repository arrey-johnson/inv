/**
 * Settlement of receivables (invoices and advance invoices): how payments, credit notes and applied
 * advances turn into paid amount, balance due and status.
 *
 * Pure functions on the shared finance engine (`calculateBalance`, Decimal.js). The demo repository
 * calls them directly; the SQL `recompute_document_settlement()` (00012) mirrors the same rules.
 *
 * Conventions
 *  - `netPayable` is what the customer owes: Total TTC less any withholding.
 *  - Credit notes are expressed in TTC. Against an invoice that carries a withholding, a credit of X TTC
 *    reduces what is owed in the same proportion as the invoice (net payable / total TTC), so crediting
 *    the whole invoice settles it exactly. Without withholding the factor is 1.
 *  - A status is never changed on VOID or DRAFT documents.
 */
import { calculateBalance } from "@/lib/finance/calculate-document";
import { formatMoney } from "@/lib/finance/format";
import { D, ZERO, roundMoney, sumDecimals, toDecimal, type CurrencyCode, type DecimalInput } from "@/lib/finance/money";
import type { DocumentStatus } from "@/types/database";

export interface SettlementInput {
  currency: CurrencyCode;
  totalTTC: DecimalInput;
  netPayable: DecimalInput;
  /** Allocation amounts of non-voided payments. */
  payments: ReadonlyArray<DecimalInput>;
  /** TTC amounts of credit notes applied to the invoice. */
  creditNotesTTC: ReadonlyArray<DecimalInput>;
  /** Amounts of advances deducted from the invoice. */
  advances: ReadonlyArray<DecimalInput>;
}

export interface Settlement {
  paidAmount: number;
  /** Credit TTC converted to the amount it takes off what is owed. */
  creditedAmount: number;
  /** Credit notes in TTC (capacity accounting). */
  creditedTTC: number;
  advanceAppliedAmount: number;
  balanceDue: number;
  /** Settled beyond what was owed (e.g. a credit note on an invoice that was already paid). */
  overpaidAmount: number;
  settledAmount: number;
  fullyCredited: boolean;
}

/** The part of a TTC credit that reduces the amount owed (see conventions above). */
export function creditEffect(
  creditTTC: DecimalInput,
  totalTTC: DecimalInput,
  netPayable: DecimalInput,
  currency: CurrencyCode,
): number {
  const credit = toDecimal(creditTTC);
  const total = toDecimal(totalTTC);
  if (credit.isZero() || total.isZero()) return 0;
  const net = toDecimal(netPayable);
  if (net.equals(total)) return roundMoney(credit, currency).toNumber();
  return roundMoney(credit.times(net).dividedBy(total), currency).toNumber();
}

/**
 * Per-credit effect when several credit notes were applied one after the other. Rounding is done on
 * the CUMULATIVE amount, so the parts always add up to `creditEffect(sum)` exactly.
 */
export function creditEffectsInOrder(
  creditsTTC: ReadonlyArray<DecimalInput>,
  totalTTC: DecimalInput,
  netPayable: DecimalInput,
  currency: CurrencyCode,
): number[] {
  let cumulative = ZERO;
  let previous = ZERO;
  return creditsTTC.map((credit) => {
    cumulative = cumulative.plus(toDecimal(credit));
    const effect = new D(creditEffect(cumulative, totalTTC, netPayable, currency));
    const part = effect.minus(previous);
    previous = effect;
    return part.toNumber();
  });
}

export function computeSettlement(input: SettlementInput): Settlement {
  const creditedTTC = roundMoney(sumDecimals(input.creditNotesTTC), input.currency);
  const creditedEffect = creditEffect(creditedTTC, input.totalTTC, input.netPayable, input.currency);
  const balance = calculateBalance({
    currency: input.currency,
    netPayable: input.netPayable,
    payments: input.payments,
    creditNotes: [creditedEffect],
    advances: input.advances,
  });
  return {
    paidAmount: balance.paidAmount,
    creditedAmount: balance.creditedAmount,
    creditedTTC: creditedTTC.toNumber(),
    advanceAppliedAmount: balance.advanceAppliedAmount,
    balanceDue: balance.balanceDue,
    overpaidAmount: balance.overpaidAmount,
    settledAmount: balance.settledAmount,
    fullyCredited: creditedTTC.greaterThan(0) && creditedTTC.greaterThanOrEqualTo(roundMoney(input.totalTTC, input.currency)),
  };
}

export interface StatusInput {
  current: DocumentStatus;
  netPayable: DecimalInput;
  settlement: Settlement;
  dueDate: string | null;
  today: string;
  sentAt: string | null;
}

/**
 * The stored status of an invoice from its settlement.
 *
 *  - VOID and DRAFT are never overwritten.
 *  - PAID: nothing left to pay and money (or an advance / partial credit) settled it, or the invoice was free.
 *  - CREDITED: nothing left to pay and the whole invoice was cancelled by credit notes (no money moved).
 *  - OVERDUE: past the due date with a balance - also when partially paid. The paid amount stays visible.
 */
export function deriveSettlementStatus(input: StatusInput): DocumentStatus {
  const { current, settlement } = input;
  if (current === "void" || current === "draft") return current;

  const overdue = input.dueDate !== null && input.dueDate < input.today;
  if (settlement.balanceDue <= 0) {
    const free = toDecimal(input.netPayable).isZero();
    if (settlement.settledAmount > 0 || free) {
      const onlyCredit = settlement.fullyCredited && settlement.paidAmount === 0 && settlement.advanceAppliedAmount === 0;
      return onlyCredit ? "credited" : "paid";
    }
    return current;
  }
  if (overdue) return "overdue";
  // A credit note alone lowers the balance but is not a payment: the invoice stays "issued"/"sent".
  if (settlement.paidAmount > 0 || settlement.advanceAppliedAmount > 0) return "partially_paid";
  return input.sentAt ? "sent" : "issued";
}

// ---------------------------------------------------------------------------------------------
// Payment allocation rules
// ---------------------------------------------------------------------------------------------

/** What the allocation rules need to know about an invoice. */
export interface PayableDocument {
  id: string;
  number: string | null;
  document_type: string;
  status: DocumentStatus;
  customer_id: string;
  currency: CurrencyCode;
  balance_due: number;
  due_date: string | null;
}

const PAYABLE_TYPES = new Set(["invoice", "advance"]);
const PAYABLE_STATUSES: ReadonlySet<DocumentStatus> = new Set(["issued", "sent", "partially_paid", "overdue"]);

export function isPayableDocument(doc: Pick<PayableDocument, "document_type" | "status" | "balance_due">): boolean {
  return PAYABLE_TYPES.has(doc.document_type) && PAYABLE_STATUSES.has(doc.status) && doc.balance_due > 0;
}

export interface AllocationCheckInput {
  amount: DecimalInput;
  currency: CurrencyCode;
  customerId: string;
  allocations: ReadonlyArray<{ documentId: string; amount: DecimalInput }>;
  documents: ReadonlyMap<string, PayableDocument>;
}

/**
 * Validates a payment against the invoices it pays. Returns every problem (empty = valid).
 * Overpayment is refused with a message that names the invoice and both amounts.
 */
export function checkPaymentAllocations(input: AllocationCheckInput): string[] {
  const errors: string[] = [];
  const money = (value: DecimalInput) => formatMoney(value, input.currency);
  const amount = roundMoney(input.amount, input.currency);

  if (!amount.greaterThan(0)) errors.push("The payment amount must be greater than zero.");
  if (input.allocations.length === 0) errors.push("Select at least one invoice to apply this payment to.");

  const seen = new Set<string>();
  for (const allocation of input.allocations) {
    const doc = input.documents.get(allocation.documentId);
    if (!doc) {
      errors.push("One of the selected invoices could not be found.");
      continue;
    }
    const label = doc.number ?? "the invoice";
    if (seen.has(doc.id)) {
      errors.push(`${label} appears twice in the allocation.`);
      continue;
    }
    seen.add(doc.id);

    const part = roundMoney(allocation.amount, input.currency);
    if (!part.greaterThan(0)) {
      errors.push(`Enter an amount greater than zero for ${label}, or remove it.`);
      continue;
    }
    if (!PAYABLE_TYPES.has(doc.document_type)) errors.push(`${label} is not an invoice, so it cannot receive a payment.`);
    else if (doc.status === "draft") errors.push(`${label} is still a draft. Issue it before recording a payment.`);
    else if (doc.status === "void") errors.push(`${label} is cancelled and cannot receive a payment.`);
    else if (doc.status === "paid") errors.push(`${label} is already fully paid.`);
    else if (doc.status === "credited") errors.push(`${label} has been fully credited: nothing is left to pay.`);
    else if (!PAYABLE_STATUSES.has(doc.status)) errors.push(`${label} (${doc.status}) cannot receive a payment.`);
    if (doc.customer_id !== input.customerId) errors.push(`${label} belongs to a different customer.`);
    if (doc.currency !== input.currency) errors.push(`${label} is in ${doc.currency}; the payment is in ${input.currency}.`);
    if (part.greaterThan(doc.balance_due)) {
      errors.push(
        `Overpayment: ${money(part)} is more than the balance due on ${label} (${money(doc.balance_due)}). ` +
          `Reduce the amount to at most ${money(doc.balance_due)}.`,
      );
    }
  }

  const allocated = sumDecimals(input.allocations.map((a) => roundMoney(a.amount, input.currency)));
  if (amount.greaterThan(0) && input.allocations.length > 0 && !allocated.equals(amount)) {
    errors.push(
      allocated.greaterThan(amount)
        ? `The amounts applied to invoices (${money(allocated)}) are more than the payment (${money(amount)}).`
        : `${money(amount.minus(allocated))} of the payment (${money(amount)}) is not applied to any invoice. ` +
            "Apply the full amount, or lower the payment amount (unapplied money is not accepted).",
    );
  }
  return errors;
}

/** Oldest-due-first allocation of `amount` over open invoices; stops when the money runs out. */
export function allocateOldestFirst(
  amount: DecimalInput,
  documents: ReadonlyArray<Pick<PayableDocument, "id" | "balance_due" | "due_date" | "currency">>,
  currency: CurrencyCode,
): { allocations: Array<{ documentId: string; amount: number }>; unallocated: number } {
  let remaining = roundMoney(amount, currency);
  const ordered = [...documents].sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"));
  const allocations: Array<{ documentId: string; amount: number }> = [];
  for (const doc of ordered) {
    if (!remaining.greaterThan(0)) break;
    const balance = toDecimal(doc.balance_due);
    if (!balance.greaterThan(0)) continue;
    const part = remaining.lessThan(balance) ? remaining : balance;
    allocations.push({ documentId: doc.id, amount: part.toNumber() });
    remaining = remaining.minus(part);
  }
  return { allocations, unallocated: remaining.toNumber() };
}
