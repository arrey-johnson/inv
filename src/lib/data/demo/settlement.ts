import { isReceivableType } from "@/lib/documents/status";
import { computeSettlement, deriveSettlementStatus } from "@/lib/payments/settlement";
import type { DocumentRow } from "@/types/database";
import type { DemoState } from "./state";

/**
 * Mirror of `recompute_document_settlement()` (00012): rebuild paid / credited / advance amounts, the
 * balance and the status of one invoice from its payment allocations and links.
 * Call inside `store.write` after anything that changes what is paid against a document.
 */
export function recomputeDocument(state: DemoState, documentId: string, today: string): DocumentRow | null {
  const doc = state.documents.find((d) => d.id === documentId && !d.deleted_at);
  if (!doc || !isReceivableType(doc.document_type) || doc.status === "draft" || doc.status === "void") return doc ?? null;

  const voided = new Set(state.payments.filter((p) => p.voided_at).map((p) => p.id));
  const payments = state.payment_allocations
    .filter((a) => a.document_id === doc.id && !voided.has(a.payment_id))
    .map((a) => a.amount);
  const credits = state.credit_note_links
    .filter((l) => l.invoice_id === doc.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((l) => l.amount);
  const advances = state.advance_links.filter((l) => l.invoice_id === doc.id).map((l) => l.amount);

  const settlement = computeSettlement({
    currency: doc.currency,
    totalTTC: doc.total_ttc,
    netPayable: doc.net_payable,
    payments,
    creditNotesTTC: credits,
    advances,
  });

  doc.paid_amount = settlement.paidAmount;
  doc.credited_amount = settlement.creditedAmount;
  doc.advance_applied_amount = settlement.advanceAppliedAmount;
  doc.balance_due = settlement.balanceDue;
  doc.status = deriveSettlementStatus({
    current: doc.status,
    netPayable: doc.net_payable,
    settlement,
    dueDate: doc.due_date,
    today,
    sentAt: doc.sent_at,
  });
  doc.updated_at = new Date().toISOString();
  return doc;
}
