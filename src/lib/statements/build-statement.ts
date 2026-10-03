import { creditEffectsInOrder } from "@/lib/payments/settlement";
import { D, ZERO, roundMoney, type CurrencyCode } from "@/lib/finance/money";
import type { AdvanceLink, Customer, CreditNoteLink, DocumentRow, Payment, PaymentAllocation } from "@/types/database";

/**
 * Customer account statement: what the customer was invoiced (debit) and what reduced it (credit), with a
 * running balance. Balances are what the customer OWES: an invoice with a withholding is a debit of its NET
 * payable, because the withheld part is never collected from the customer.
 *
 * Included: issued invoices and advance invoices (debit); applied credit notes, received payments and
 * advance deductions (credit). Excluded: drafts, cancelled (void) documents and cancelled payments, so the
 * statement matches what is really outstanding.
 */
export type StatementEntryType = "invoice" | "advance" | "credit_note" | "payment" | "advance_application";

export interface StatementEntry {
  date: string;
  type: StatementEntryType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  documentId: string | null;
}

export interface CustomerStatement {
  customerId: string;
  currency: CurrencyCode;
  from: string;
  to: string;
  openingBalance: number;
  entries: StatementEntry[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  /** Entries dated after `to` are ignored; this counts the open invoices in other currencies left out. */
  excludedOtherCurrency: number;
}

export interface StatementInput {
  customer: Pick<Customer, "id" | "name">;
  currency: CurrencyCode;
  from: string;
  to: string;
  documents: ReadonlyArray<DocumentRow>;
  payments: ReadonlyArray<Payment>;
  allocations: ReadonlyArray<PaymentAllocation>;
  creditLinks: ReadonlyArray<CreditNoteLink>;
  advanceLinks: ReadonlyArray<AdvanceLink>;
}

const TYPE_ORDER: Record<StatementEntryType, number> = {
  invoice: 0,
  advance: 0,
  credit_note: 1,
  advance_application: 1,
  payment: 2,
};

const METHOD_LABEL = (method: string) => method.replace(/_/g, " ");

export function buildCustomerStatement(input: StatementInput): CustomerStatement {
  const { currency } = input;
  const customerDocs = input.documents.filter((d) => d.customer_id === input.customer.id && !d.deleted_at);
  const docs = customerDocs.filter((d) => d.currency === currency);
  const byId = new Map(customerDocs.map((d) => [d.id, d]));

  type Raw = Omit<StatementEntry, "balance"> & { sort: string };
  const raw: Raw[] = [];

  for (const doc of docs) {
    if ((doc.document_type === "invoice" || doc.document_type === "advance") && doc.status !== "draft" && doc.status !== "void" && doc.number) {
      raw.push({
        date: doc.issue_date,
        type: doc.document_type,
        reference: doc.number,
        description: doc.document_type === "advance" ? "Advance invoice" : (doc.subject ?? "Invoice"),
        debit: doc.net_payable,
        credit: 0,
        documentId: doc.id,
        sort: doc.created_at,
      });
    }
  }

  // Credit notes: the part that actually reduces what is owed (proportional when the invoice carries a withholding).
  const linksByInvoice = new Map<string, CreditNoteLink[]>();
  for (const link of input.creditLinks) {
    const list = linksByInvoice.get(link.invoice_id) ?? [];
    list.push(link);
    linksByInvoice.set(link.invoice_id, list);
  }
  for (const [invoiceId, links] of linksByInvoice) {
    const invoice = byId.get(invoiceId);
    if (!invoice || invoice.currency !== currency) continue;
    const ordered = [...links].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const effects = creditEffectsInOrder(ordered.map((l) => l.amount), invoice.total_ttc, invoice.net_payable, currency);
    ordered.forEach((link, index) => {
      const note = byId.get(link.credit_note_id);
      if (!note || note.status === "void" || !note.number) return;
      raw.push({
        date: note.issue_date,
        type: "credit_note",
        reference: note.number,
        description: `Credit note for invoice ${invoice.number ?? ""}`.trim(),
        debit: 0,
        credit: effects[index] ?? 0,
        documentId: note.id,
        sort: note.created_at,
      });
    });
  }

  // Advance deductions reduce the final invoice.
  for (const link of input.advanceLinks) {
    const invoice = byId.get(link.invoice_id);
    const advance = byId.get(link.advance_document_id);
    if (!invoice || invoice.currency !== currency || !advance || invoice.status === "void") continue;
    raw.push({
      date: link.created_at.slice(0, 10),
      type: "advance_application",
      reference: invoice.number ?? "",
      description: `Advance ${advance.number ?? ""} deducted`.trim(),
      debit: 0,
      credit: link.amount,
      documentId: invoice.id,
      sort: link.created_at,
    });
  }

  // Payments (non-cancelled) of this customer.
  const allocationsByPayment = new Map<string, PaymentAllocation[]>();
  for (const a of input.allocations) {
    const list = allocationsByPayment.get(a.payment_id) ?? [];
    list.push(a);
    allocationsByPayment.set(a.payment_id, list);
  }
  for (const payment of input.payments) {
    if (payment.customer_id !== input.customer.id || payment.currency !== currency || payment.voided_at) continue;
    const allocations = allocationsByPayment.get(payment.id) ?? [];
    const numbers = allocations.map((a) => byId.get(a.document_id)?.number).filter(Boolean);
    raw.push({
      date: payment.payment_date,
      type: "payment",
      reference: payment.reference ?? "Payment",
      description: `${payment.is_adjustment ? "Adjustment" : `Payment (${METHOD_LABEL(payment.method)})`}${numbers.length ? ` for ${numbers.join(", ")}` : ""}`,
      debit: 0,
      credit: payment.amount,
      documentId: allocations[0]?.document_id ?? null,
      sort: payment.created_at,
    });
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.sort.localeCompare(b.sort));

  let opening = ZERO;
  let running = ZERO;
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const entries: StatementEntry[] = [];
  for (const entry of raw) {
    if (entry.date > input.to) continue;
    const delta = new D(entry.debit).minus(entry.credit);
    if (entry.date < input.from) {
      opening = opening.plus(delta);
      running = opening;
      continue;
    }
    running = running.plus(delta);
    totalDebit = totalDebit.plus(entry.debit);
    totalCredit = totalCredit.plus(entry.credit);
    const rest: Omit<typeof entry, "sort"> & { sort?: unknown } = { ...entry };
    delete rest.sort;
    entries.push({ ...(rest as Omit<typeof entry, "sort">), balance: roundMoney(running, currency).toNumber() });
  }

  return {
    customerId: input.customer.id,
    currency,
    from: input.from,
    to: input.to,
    openingBalance: roundMoney(opening, currency).toNumber(),
    entries,
    totalDebit: roundMoney(totalDebit, currency).toNumber(),
    totalCredit: roundMoney(totalCredit, currency).toNumber(),
    closingBalance: roundMoney(running, currency).toNumber(),
    excludedOtherCurrency: customerDocs.filter(
      (d) => d.currency !== currency && d.status !== "draft" && d.status !== "void" && d.balance_due > 0,
    ).length,
  };
}
