import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PAGE_SIZE,
  RepositoryError,
  type AttachmentRepository,
  type AuditRepository,
  type EmailLogRepository,
  type PaymentFilter,
  type PaymentListRow,
  type PaymentRepository,
  type RepositoryContext,
  type SettlementRepository,
} from "@/lib/data/types";
import { checkPaymentAllocations, type PayableDocument } from "@/lib/payments/settlement";
import { roundMoney, sumDecimals } from "@/lib/finance/money";
import { todayISO } from "@/lib/utils/date-math";
import type { Attachment, DocumentRow, Payment } from "@/types/database";
import { matchesQuery, paginate } from "./rows";
import { recomputeDocument } from "./settlement";
import type { DemoState } from "./state";
import type { DemoStore } from "./store";

function toListRow(state: Readonly<DemoState>, payment: Payment): PaymentListRow {
  const customer = state.customers.find((c) => c.id === payment.customer_id);
  const docNumber = new Map(state.documents.map((d) => [d.id, d.number]));
  return {
    ...payment,
    customer_name: customer?.name ?? "Unknown customer",
    allocations: state.payment_allocations
      .filter((a) => a.payment_id === payment.id)
      .map((a) => ({ ...a, document_number: docNumber.get(a.document_id) ?? null })),
  };
}

function filterPayments(state: Readonly<DemoState>, filter: Omit<PaymentFilter, "page" | "pageSize">): PaymentListRow[] {
  return state.payments
    .filter((p) => (filter.includeVoided ? true : !p.voided_at))
    .filter((p) => (filter.customerId ? p.customer_id === filter.customerId : true))
    .filter((p) => (filter.method ? p.method === filter.method : true))
    .filter((p) => (filter.dateFrom ? p.payment_date >= filter.dateFrom : true))
    .filter((p) => (filter.dateTo ? p.payment_date <= filter.dateTo : true))
    .map((p) => toListRow(state, p))
    .filter((p) =>
      matchesQuery(filter.q, [p.reference, p.notes, p.customer_name, ...p.allocations.map((a) => a.document_number)]),
    )
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at));
}

export function createDemoPaymentRepository(store: DemoStore, ctx: RepositoryContext): PaymentRepository {
  return {
    list: (filter) =>
      store.read((state) => paginate(filterPayments(state, filter), filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE)),

    listAll: (filter) => store.read((state) => filterPayments(state, filter).slice(0, 20_000)),

    get: (id) =>
      store.read((state) => {
        const payment = state.payments.find((p) => p.id === id);
        if (!payment) return null;
        return {
          payment,
          customer: state.customers.find((c) => c.id === payment.customer_id) ?? null,
          allocations: state.payment_allocations
            .filter((a) => a.payment_id === id)
            .map((allocation) => ({
              allocation,
              document: state.documents.find((d) => d.id === allocation.document_id) ?? null,
            })),
        };
      }),

    record: (write) =>
      store.write((state) => {
        const customer = state.customers.find((c) => c.id === write.customer_id && !c.deleted_at);
        if (!customer) throw new RepositoryError("Customer not found", "not_found");

        // Authoritative re-check against the CURRENT balances inside the transaction.
        const documents = new Map<string, PayableDocument>(
          state.documents.filter((d) => !d.deleted_at).map((d) => [d.id, d as PayableDocument]),
        );
        const errors = checkPaymentAllocations({
          amount: write.amount,
          currency: write.currency,
          customerId: write.customer_id,
          allocations: write.allocations.map((a) => ({ documentId: a.document_id, amount: a.amount })),
          documents,
        });
        if (errors.length > 0) throw new RepositoryError(errors.join(" "), "invalid");

        const ts = new Date().toISOString();
        const payment: Payment = {
          id: randomUUID(),
          organization_id: ctx.organizationId,
          customer_id: write.customer_id,
          payment_date: write.payment_date,
          amount: roundMoney(write.amount, write.currency).toNumber(),
          currency: write.currency,
          method: write.method,
          reference: write.reference,
          notes: write.notes,
          receipt_document_id: null,
          is_adjustment: write.is_adjustment,
          adjustment_reason: write.adjustment_reason,
          received_by: ctx.userId,
          voided_at: null,
          voided_by: null,
          void_reason: null,
          created_by: ctx.userId,
          created_at: ts,
          updated_at: ts,
        };
        state.payments.push(payment);
        for (const a of write.allocations) {
          state.payment_allocations.push({
            id: randomUUID(),
            organization_id: ctx.organizationId,
            payment_id: payment.id,
            document_id: a.document_id,
            amount: roundMoney(a.amount, write.currency).toNumber(),
            created_by: ctx.userId,
            created_at: ts,
          });
        }
        const today = todayISO();
        const touched = write.allocations
          .map((a) => recomputeDocument(state, a.document_id, today))
          .filter((d): d is DocumentRow => d !== null);
        return { payment, documents: touched };
      }),

    void: (id, reason) =>
      store.write((state) => {
        const payment = state.payments.find((p) => p.id === id);
        if (!payment) throw new RepositoryError("Payment not found", "not_found");
        if (payment.voided_at) throw new RepositoryError("This payment is already voided.", "conflict");
        const ts = new Date().toISOString();
        payment.voided_at = ts;
        payment.voided_by = ctx.userId;
        payment.void_reason = reason;
        payment.updated_at = ts;
        const today = todayISO();
        const documents = state.payment_allocations
          .filter((a) => a.payment_id === id)
          .map((a) => recomputeDocument(state, a.document_id, today))
          .filter((d): d is DocumentRow => d !== null);
        return { payment, documents };
      }),

    forDocument: (documentId) =>
      store.read((state) =>
        state.payment_allocations
          .filter((a) => a.document_id === documentId)
          .map((allocation) => ({ allocation, payment: state.payments.find((p) => p.id === allocation.payment_id) }))
          .filter((x): x is { allocation: typeof x.allocation; payment: Payment } => Boolean(x.payment && !x.payment.voided_at))
          .sort((a, b) => b.payment.payment_date.localeCompare(a.payment.payment_date)),
      ),
  };
}

export function createDemoSettlementRepository(store: DemoStore, ctx: RepositoryContext): SettlementRepository {
  const requireDoc = (state: DemoState, id: string): DocumentRow => {
    const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
    if (!doc) throw new RepositoryError("Document not found", "not_found");
    return doc;
  };

  return {
    creditLinks: (filter) =>
      store.read((state) =>
        state.credit_note_links.filter(
          (l) =>
            (filter?.invoiceId ? l.invoice_id === filter.invoiceId : true) &&
            (filter?.creditNoteId ? l.credit_note_id === filter.creditNoteId : true),
        ),
      ),

    advanceLinks: (filter) =>
      store.read((state) =>
        state.advance_links.filter(
          (l) =>
            (filter?.invoiceId ? l.invoice_id === filter.invoiceId : true) &&
            (filter?.advanceId ? l.advance_document_id === filter.advanceId : true),
        ),
      ),

    applyCreditNote: (link) =>
      store.write((state) => {
        const note = requireDoc(state, link.creditNoteId);
        const invoice = requireDoc(state, link.invoiceId);
        if (note.document_type !== "credit_note" || ["draft", "void"].includes(note.status)) {
          throw new RepositoryError("Only an issued credit note can be applied.", "invalid");
        }
        if (invoice.document_type !== "invoice" || ["draft", "void"].includes(invoice.status)) {
          throw new RepositoryError("Credit notes can only be applied to issued invoices.", "invalid");
        }
        if (note.customer_id !== invoice.customer_id) throw new RepositoryError("Customer mismatch", "invalid");
        if (note.currency !== invoice.currency) throw new RepositoryError("Currency mismatch", "invalid");

        const used = sumDecimals(state.credit_note_links.filter((l) => l.invoice_id === invoice.id).map((l) => l.amount));
        if (used.plus(link.amount).greaterThan(invoice.total_ttc)) {
          throw new RepositoryError("Credit notes cannot exceed the total of the invoice they credit.", "invalid");
        }
        const noteUsed = sumDecimals(state.credit_note_links.filter((l) => l.credit_note_id === note.id).map((l) => l.amount));
        if (noteUsed.plus(link.amount).greaterThan(note.total_ttc)) {
          throw new RepositoryError("The credit note amount is already fully applied.", "invalid");
        }
        state.credit_note_links.push({
          id: randomUUID(),
          organization_id: ctx.organizationId,
          credit_note_id: note.id,
          invoice_id: invoice.id,
          amount: link.amount,
          created_by: ctx.userId,
          created_at: new Date().toISOString(),
        });
        return recomputeDocument(state, invoice.id, todayISO()) as DocumentRow;
      }),

    releaseCreditNote: (creditNoteId) =>
      store.write((state) => {
        const invoiceIds = [...new Set(state.credit_note_links.filter((l) => l.credit_note_id === creditNoteId).map((l) => l.invoice_id))];
        state.credit_note_links = state.credit_note_links.filter((l) => l.credit_note_id !== creditNoteId);
        const today = todayISO();
        return invoiceIds.map((id) => recomputeDocument(state, id, today)).filter((d): d is DocumentRow => d !== null);
      }),

    applyAdvance: (link) =>
      store.write((state) => {
        const advance = requireDoc(state, link.advanceId);
        const invoice = requireDoc(state, link.invoiceId);
        if (advance.document_type !== "advance") throw new RepositoryError("Not an advance invoice.", "invalid");
        if (advance.status !== "paid") {
          throw new RepositoryError("Only an advance whose payment has been received in full can be deducted.", "invalid");
        }
        if (invoice.document_type !== "invoice" || !["issued", "sent", "partially_paid", "overdue"].includes(invoice.status)) {
          throw new RepositoryError("Advances can only be deducted from an open invoice.", "invalid");
        }
        if (advance.customer_id !== invoice.customer_id) throw new RepositoryError("Customer mismatch", "invalid");
        if (advance.currency !== invoice.currency) throw new RepositoryError("Currency mismatch", "invalid");

        const used = sumDecimals(state.advance_links.filter((l) => l.advance_document_id === advance.id).map((l) => l.amount));
        if (used.plus(link.amount).greaterThan(advance.total_ttc)) {
          throw new RepositoryError("The amount is more than what remains of the advance.", "invalid");
        }
        if (link.amount > invoice.balance_due) {
          throw new RepositoryError("The amount is more than the balance due on the invoice.", "invalid");
        }
        state.advance_links.push({
          id: randomUUID(),
          organization_id: ctx.organizationId,
          advance_document_id: advance.id,
          invoice_id: invoice.id,
          amount: link.amount,
          ht_amount: link.htAmount,
          vat_amount: link.vatAmount,
          created_by: ctx.userId,
          created_at: new Date().toISOString(),
        });
        return recomputeDocument(state, invoice.id, todayISO()) as DocumentRow;
      }),
  };
}

export function createDemoEmailLogRepository(store: DemoStore, ctx: RepositoryContext): EmailLogRepository {
  return {
    add: (log) =>
      store.write((state) => {
        const row = { ...log, id: randomUUID(), organization_id: ctx.organizationId, created_at: new Date().toISOString() };
        state.email_logs.push(row);
        return row;
      }),
    listForDocument: (documentId) =>
      store.read((state) =>
        state.email_logs.filter((e) => e.document_id === documentId).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      ),
  };
}

// Binary attachments live next to the JSON store (or in memory for tests).
const memoryBlobs = new WeakMap<DemoStore, Map<string, Uint8Array>>();

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
}

export function createDemoAttachmentRepository(store: DemoStore, ctx: RepositoryContext): AttachmentRepository {
  const blobs = () => {
    let map = memoryBlobs.get(store);
    if (!map) memoryBlobs.set(store, (map = new Map()));
    return map;
  };

  return {
    add: async (write) => {
      const id = randomUUID();
      const storagePath = `attachments/${id}-${safeFileName(write.fileName)}`;
      if (store.dataDir) {
        await mkdir(path.join(store.dataDir, "attachments"), { recursive: true });
        await writeFile(path.join(store.dataDir, storagePath), write.bytes);
      } else {
        blobs().set(id, write.bytes);
      }
      return store.write((state) => {
        const row: Attachment = {
          id,
          organization_id: ctx.organizationId,
          entity_type: write.entityType,
          entity_id: write.entityId,
          storage_bucket: "attachments",
          storage_path: storagePath,
          file_name: write.fileName,
          mime_type: write.mimeType,
          byte_size: write.bytes.byteLength,
          uploaded_by: ctx.userId,
          created_at: new Date().toISOString(),
        };
        state.attachments.push(row);
        return row;
      });
    },

    listFor: (entityType, entityId) =>
      store.read((state) => state.attachments.filter((a) => a.entity_type === entityType && a.entity_id === entityId)),

    read: async (id) => {
      const attachment = await store.read((state) => state.attachments.find((a) => a.id === id) ?? null);
      if (!attachment) return null;
      if (store.dataDir) {
        const bytes = new Uint8Array(await readFile(path.join(store.dataDir, attachment.storage_path)));
        return { attachment, bytes };
      }
      const bytes = blobs().get(id);
      return bytes ? { attachment, bytes } : null;
    },
  };
}

export function createDemoAuditRepository(store: DemoStore): AuditRepository {
  return {
    list: ({ entityIds, limit = 200 }) =>
      store.read((state) => {
        const wanted = new Set(entityIds);
        return state.audit_logs
          .filter((a) => a.entity_id !== null && wanted.has(a.entity_id))
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
          .slice(0, limit);
      }),
  };
}
