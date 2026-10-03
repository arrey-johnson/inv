import { formatDocumentNumber } from "@/lib/finance/document-number";
import { sumDecimals } from "@/lib/finance/money";
import { buildCustomerSnapshot, buildIssuerSnapshot } from "@/lib/documents/snapshots";
import { RepositoryError } from "@/lib/data/types";
import { addDaysISO, yearOfISO } from "@/lib/utils/date-math";
import { isReceivableType } from "@/lib/documents/status";
import type { DocumentRow, DocumentType } from "@/types/database";
import type { DemoState } from "./state";

/**
 * Mirror of `allocate_document_number()` (00007). Must be called inside `store.write` so the
 * increment and the document update commit together (or not at all).
 */
export function allocateNumber(state: DemoState, documentType: DocumentType, issueYear: number): string {
  if (!Number.isInteger(issueYear) || issueYear < 2000 || issueYear > 2999) {
    throw new RepositoryError(`Invalid issue year: ${issueYear}`);
  }
  const config = state.document_sequences.find((s) => s.document_type === documentType && s.is_active);
  if (!config) throw new RepositoryError(`No active numbering sequence configured for ${documentType}`, "not_found");

  const sequenceYear = config.reset_yearly ? issueYear : 0;
  let counter = state.document_sequence_counters.find(
    (c) => c.document_type === documentType && c.sequence_year === sequenceYear,
  );
  if (!counter) {
    counter = {
      organization_id: config.organization_id,
      document_type: documentType,
      sequence_year: sequenceYear,
      last_number: Math.max(config.start_number, 1),
      updated_at: new Date().toISOString(),
    };
    state.document_sequence_counters.push(counter);
  } else {
    counter.last_number += 1;
    counter.updated_at = new Date().toISOString();
  }
  return formatDocumentNumber(config, issueYear, counter.last_number);
}

/** Mirror of `issue_document()` (00011): validate stored totals, snapshot, number, due dates. */
export function issueInState(state: DemoState, documentId: string, actorId: string | null, now: Date): DocumentRow {
  const doc = state.documents.find((d) => d.id === documentId && !d.deleted_at);
  if (!doc) throw new RepositoryError(`Document ${documentId} not found`, "not_found");
  if (doc.status !== "draft") {
    throw new RepositoryError(`Only draft documents can be issued (current status: ${doc.status})`, "immutable");
  }
  if (state.settings.require_approval && doc.approval_status !== "approved") {
    throw new RepositoryError("This document must be approved before it can be issued", "conflict");
  }

  const items = state.document_items.filter((i) => i.document_id === doc.id);
  if (items.length === 0) {
    throw new RepositoryError("A document needs at least one line before it can be issued", "invalid");
  }
  const linesTtc = sumDecimals(items.map((i) => i.total_amount));
  const linesHt = sumDecimals(items.map((i) => i.taxable_amount));
  if (!linesTtc.equals(doc.total_ttc) || !linesHt.equals(doc.net_ht)) {
    throw new RepositoryError("Document totals are out of sync with its lines (recalculate and save first)", "invalid");
  }
  const withholdings = sumDecimals(
    state.document_withholdings.filter((w) => w.document_id === doc.id).map((w) => w.amount),
  );
  if (!withholdings.equals(doc.withholding_total)) {
    throw new RepositoryError("Withholding total is out of sync with its lines", "invalid");
  }

  const customer = state.customers.find((c) => c.id === doc.customer_id);
  if (!customer) throw new RepositoryError("Customer not found", "not_found");

  const terms = customer.payment_terms_days ?? state.settings.default_payment_terms_days ?? 30;
  const number = allocateNumber(state, doc.document_type, yearOfISO(doc.issue_date));
  const ts = now.toISOString();

  doc.number = number;
  doc.status = "issued";
  doc.issued_at = ts;
  doc.issued_by = actorId;
  if (isReceivableType(doc.document_type)) doc.due_date = doc.due_date ?? addDaysISO(doc.issue_date, terms);
  if (doc.document_type === "proforma") {
    doc.valid_until = doc.valid_until ?? addDaysISO(doc.issue_date, state.settings.proforma_validity_days ?? 30);
  }
  doc.balance_due = isReceivableType(doc.document_type) ? doc.net_payable : 0;
  doc.customer_snapshot = buildCustomerSnapshot(customer);
  doc.issuer_snapshot = buildIssuerSnapshot(state.organization, state.settings, state.payment_destinations);
  doc.updated_at = ts;
  return doc;
}
