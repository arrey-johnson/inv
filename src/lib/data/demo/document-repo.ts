import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PAGE_SIZE,
  RepositoryError,
  type DocumentListRow,
  type DocumentFilter,
  type DocumentRepository,
  type DraftWrite,
  type RepositoryContext,
} from "@/lib/data/types";
import { isOpenInvoiceStatus, isReceivableType } from "@/lib/documents/status";
import type { DocumentRow } from "@/types/database";
import { recomputeDocument } from "./settlement";
import { issueInState } from "./issue";
import { matchesQuery, newDocumentRow, newItemRow, paginate } from "./rows";
import type { DemoState } from "./state";
import type { DemoStore } from "./store";

function requireDraft(state: DemoState, id: string): DocumentRow {
  const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
  if (!doc) throw new RepositoryError("Document not found", "not_found");
  if (doc.status !== "draft") {
    throw new RepositoryError(`Document ${doc.number ?? id} is ${doc.status} and can no longer be edited`, "immutable");
  }
  return doc;
}

function writeChildren(state: DemoState, ctx: RepositoryContext, doc: DocumentRow, write: DraftWrite, ts: string) {
  state.document_items = state.document_items.filter((i) => i.document_id !== doc.id);
  state.document_withholdings = state.document_withholdings.filter((w) => w.document_id !== doc.id);
  for (const item of write.items) state.document_items.push(newItemRow(ctx.organizationId, doc.id, item, ts));
  for (const w of write.withholdings) {
    state.document_withholdings.push({
      id: randomUUID(),
      organization_id: ctx.organizationId,
      document_id: doc.id,
      withholding_type_id: w.withholding_type_id ?? null,
      code: w.code,
      name: w.name,
      rate: w.rate,
      base: w.base ?? "net_ht",
      base_amount: w.base_amount,
      amount: w.amount,
      created_at: ts,
    });
  }
}

function filterDocuments(state: Readonly<DemoState>, filter: Omit<DocumentFilter, "page" | "pageSize">): DocumentListRow[] {
  const customerName = new Map(state.customers.map((c) => [c.id, c.name]));
  const types = new Set([...(filter.type ? [filter.type] : []), ...(filter.types ?? [])]);
  return state.documents
    .filter((d) => !d.deleted_at)
    .filter((d) => (types.size > 0 ? types.has(d.document_type) : true))
    .filter((d) => (filter.statuses?.length ? filter.statuses.includes(d.status) : true))
    .filter((d) => (filter.customerId ? d.customer_id === filter.customerId : true))
    .filter((d) => (filter.dateFrom ? d.issue_date >= filter.dateFrom : true))
    .filter((d) => (filter.dateTo ? d.issue_date <= filter.dateTo : true))
    .filter((d) => (filter.minAmount !== undefined ? d.total_ttc >= filter.minAmount : true))
    .filter((d) => (filter.maxAmount !== undefined ? d.total_ttc <= filter.maxAmount : true))
    .filter((d) =>
      filter.overdueOnly
        ? isReceivableType(d.document_type) &&
          isOpenInvoiceStatus(d.status) &&
          d.balance_due > 0 &&
          d.due_date !== null &&
          d.due_date < filter.today
        : true,
    )
    .filter((d) => matchesQuery(filter.q, [d.number, d.reference, d.subject, customerName.get(d.customer_id)]))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.created_at.localeCompare(a.created_at))
    .map((d) => ({ ...d, customer_name: customerName.get(d.customer_id) ?? "Unknown customer" }));
}
export function createDemoDocumentRepository(store: DemoStore, ctx: RepositoryContext): DocumentRepository {
  return {
    list: (filter) =>
      store.read((state) => paginate(filterDocuments(state, filter), filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE)),

    listAll: (filter) => store.read((state) => filterDocuments(state, filter).slice(0, 20_000)),

    listItems: (documentIds) =>
      store.read((state) => {
        const wanted = new Set(documentIds);
        return state.document_items.filter((i) => wanted.has(i.document_id));
      }),

    voidDocument: (id, reason) =>
      store.write((state) => {
        const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
        if (!doc) throw new RepositoryError("Document not found", "not_found");
        if (doc.status === "draft") throw new RepositoryError("A draft is deleted, not cancelled.", "invalid");
        if (doc.status === "void") throw new RepositoryError("This document is already cancelled.", "conflict");
        const ts = new Date().toISOString();
        doc.status = "void";
        doc.voided_at = ts;
        doc.voided_by = ctx.userId;
        doc.void_reason = reason;
        doc.balance_due = 0;
        doc.updated_at = ts;
        return doc;
      }),

    syncOverdue: (today) =>
      store.write((state) => {
        let changed = 0;
        for (const doc of state.documents) {
          if (doc.deleted_at || !isReceivableType(doc.document_type)) continue;
          if (!["issued", "sent", "partially_paid", "overdue"].includes(doc.status)) continue;
          const before = doc.status;
          recomputeDocument(state, doc.id, today);
          if (doc.status !== before) changed += 1;
        }
        return changed;
      }),

    setPublicLink: (id, link) =>
      store.write((state) => {
        const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
        if (!doc) throw new RepositoryError("Document not found", "not_found");
        if (link) {
          doc.public_token_hash = link.hash;
          doc.public_token_created_at = link.createdAt;
          doc.public_token_expires_at = link.expiresAt;
          doc.public_token_revoked_at = null;
        } else {
          doc.public_token_revoked_at = new Date().toISOString();
        }
        return doc;
      }),

    findByTokenHash: (hash) =>
      store.read((state) => state.documents.find((d) => !d.deleted_at && d.public_token_hash === hash) ?? null),
    get: (id) =>
      store.read((state) => {
        const document = state.documents.find((d) => d.id === id && !d.deleted_at);
        if (!document) return null;
        return {
          document,
          items: state.document_items.filter((i) => i.document_id === id).sort((a, b) => a.position - b.position),
          withholdings: state.document_withholdings.filter((w) => w.document_id === id),
          customer: state.customers.find((c) => c.id === document.customer_id) ?? null,
        };
      }),

    insertDraft: (write) =>
      store.write((state) => {
        if (!state.customers.some((c) => c.id === write.document.customer_id)) {
          throw new RepositoryError("Customer not found", "not_found");
        }
        const ts = new Date().toISOString();
        const doc = newDocumentRow(ctx.organizationId, write.document, ctx.userId, ts);
        state.documents.push(doc);
        writeChildren(state, ctx, doc, write, ts);
        return doc;
      }),

    replaceDraft: (id, write) =>
      store.write((state) => {
        const doc = requireDraft(state, id);
        const ts = new Date().toISOString();
        const fresh = newDocumentRow(ctx.organizationId, { ...write.document, customer_id: write.document.customer_id }, ctx.userId, ts);
        // Keep identity + provenance; replace everything the editor owns.
        Object.assign(doc, fresh, {
          id: doc.id,
          created_at: doc.created_at,
          created_by: doc.created_by,
          converted_from_document_id: write.document.converted_from_document_id ?? doc.converted_from_document_id,
          updated_at: ts,
        });
        writeChildren(state, ctx, doc, write, ts);
        return doc;
      }),

    replaceIssuedContent: (id, write, snapshots) =>
      store.write((state) => {
        const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
        if (!doc) throw new RepositoryError("Document not found", "not_found");
        if (doc.status === "draft") {
          throw new RepositoryError("Use the draft save path for draft documents.", "invalid");
        }
        if (doc.status === "void") {
          throw new RepositoryError("Voided documents cannot be edited.", "immutable");
        }
        const ts = new Date().toISOString();
        const number = doc.number;
        const issuedAt = doc.issued_at;
        const issuedBy = doc.issued_by;
        const status = doc.status;
        const paid = doc.paid_amount;
        const credited = doc.credited_amount;
        const advance = doc.advance_applied_amount;
        Object.assign(doc, {
          ...write.document,
          id: doc.id,
          organization_id: doc.organization_id,
          number,
          status,
          issued_at: issuedAt,
          issued_by: issuedBy,
          paid_amount: paid,
          credited_amount: credited,
          advance_applied_amount: advance,
          customer_snapshot: snapshots.customerSnapshot,
          issuer_snapshot: snapshots.issuerSnapshot,
          pdf_storage_path: null,
          pdf_sha256: null,
          pdf_generated_at: null,
          created_at: doc.created_at,
          created_by: doc.created_by,
          updated_at: ts,
          updated_by: ctx.userId,
        });
        writeChildren(state, ctx, doc, write, ts);
        return recomputeDocument(state, id, ts.slice(0, 10)) ?? doc;
      }),

    deleteDraft: (id) =>
      store.write((state) => {
        const doc = requireDraft(state, id);
        state.documents = state.documents.filter((d) => d.id !== doc.id);
        state.document_items = state.document_items.filter((i) => i.document_id !== doc.id);
        state.document_withholdings = state.document_withholdings.filter((w) => w.document_id !== doc.id);
        state.document_links = state.document_links.filter((l) => l.source_document_id !== id && l.target_document_id !== id);
      }),

    patchWorkflow: (id, patch) =>
      store.write((state) => {
        const doc = state.documents.find((d) => d.id === id && !d.deleted_at);
        if (!doc) throw new RepositoryError("Document not found", "not_found");
        if (doc.status !== "draft" && patch.approval_status !== undefined) {
          throw new RepositoryError("Approval can only change while the document is a draft", "immutable");
        }
        Object.assign(doc, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), {
          updated_at: new Date().toISOString(),
        });
        return doc;
      }),

    issue: (id) => store.write((state) => issueInState(state, id, ctx.userId, new Date())),

    storePdf: async (id, pdf) => {
      const relativePath = `pdfs/${id}.pdf`;
      if (store.dataDir) {
        await mkdir(path.join(store.dataDir, "pdfs"), { recursive: true });
        await writeFile(path.join(store.dataDir, relativePath), pdf.bytes);
      }
      await store.write((state) => {
        const doc = state.documents.find((d) => d.id === id);
        if (!doc) throw new RepositoryError("Document not found", "not_found");
        doc.pdf_sha256 = pdf.sha256;
        doc.pdf_generated_at = pdf.generatedAt;
        doc.pdf_storage_path = store.dataDir ? relativePath : null;
      });
    },

    link: (sourceId, targetId, type) =>
      store.write((state) => {
        state.document_links.push({
          id: randomUUID(),
          organization_id: ctx.organizationId,
          source_document_id: sourceId,
          target_document_id: targetId,
          link_type: type,
          created_by: ctx.userId,
          created_at: new Date().toISOString(),
        });
      }),

    linksFor: (id) =>
      store.read((state) => state.document_links.filter((l) => l.source_document_id === id || l.target_document_id === id)),

    findConvertedInvoices: (proformaId) =>
      store.read((state) =>
        state.documents.filter((d) => !d.deleted_at && d.converted_from_document_id === proformaId && d.document_type === "invoice"),
      ),
  };
}
