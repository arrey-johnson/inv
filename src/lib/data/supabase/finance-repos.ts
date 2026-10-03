import type { SupabaseClient } from "@supabase/supabase-js";
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
import type { Database, DocumentRow, Payment } from "@/types/database";
import { rangeFor, searchTerm, toRepositoryError, unwrap } from "./helpers";

type Client = SupabaseClient<Database>;
const MAX_REPORT_ROWS = 20_000;

async function loadDocuments(db: Client, ids: string[]): Promise<DocumentRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("documents").select("*").in("id", [...new Set(ids)]);
  if (error) throw toRepositoryError(error, "Could not reload the documents");
  return data ?? [];
}

export function createSupabasePaymentRepository(db: Client, ctx: RepositoryContext): PaymentRepository {
  async function decorate(payments: Payment[]): Promise<PaymentListRow[]> {
    if (payments.length === 0) return [];
    const paymentIds = payments.map((p) => p.id);
    const [allocs, customers] = await Promise.all([
      db.from("payment_allocations").select("*").in("payment_id", paymentIds),
      db.from("customers").select("id, name").in("id", [...new Set(payments.map((p) => p.customer_id))]),
    ]);
    if (allocs.error) throw toRepositoryError(allocs.error, "Could not load payment allocations");
    const docs = await loadDocuments(db, (allocs.data ?? []).map((a) => a.document_id));
    const numbers = new Map(docs.map((d) => [d.id, d.number]));
    const names = new Map((customers.data ?? []).map((c) => [c.id, c.name]));
    return payments.map((p) => ({
      ...p,
      customer_name: names.get(p.customer_id) ?? "Unknown customer",
      allocations: (allocs.data ?? [])
        .filter((a) => a.payment_id === p.id)
        .map((a) => ({ ...a, document_number: numbers.get(a.document_id) ?? null })),
    }));
  }

  async function search(filter: Omit<PaymentFilter, "page" | "pageSize">, range?: { from: number; to: number }) {
    let query = db
      .from("payments")
      .select("*", { count: "exact" })
      .eq("organization_id", ctx.organizationId);
    if (!filter.includeVoided) query = query.is("voided_at", null);
    if (filter.customerId) query = query.eq("customer_id", filter.customerId);
    if (filter.method) query = query.eq("method", filter.method);
    if (filter.dateFrom) query = query.gte("payment_date", filter.dateFrom);
    if (filter.dateTo) query = query.lte("payment_date", filter.dateTo);
    const term = searchTerm(filter.q);
    if (term) {
      const [{ data: customers }, { data: docs }] = await Promise.all([
        db.from("customers").select("id").eq("organization_id", ctx.organizationId).ilike("name", `%${term}%`).limit(50),
        db.from("documents").select("id").eq("organization_id", ctx.organizationId).ilike("number", `%${term}%`).limit(50),
      ]);
      const clauses = [`reference.ilike.%${term}%`, `notes.ilike.%${term}%`];
      if (customers?.length) clauses.push(`customer_id.in.(${customers.map((c) => c.id).join(",")})`);
      if (docs?.length) {
        const { data: allocs } = await db.from("payment_allocations").select("payment_id").in("document_id", docs.map((d) => d.id));
        const ids = [...new Set((allocs ?? []).map((a) => a.payment_id))];
        if (ids.length) clauses.push(`id.in.(${ids.join(",")})`);
      }
      query = query.or(clauses.join(","));
    }
    query = query.order("payment_date", { ascending: false }).order("created_at", { ascending: false });
    const { data, error, count } = range ? await query.range(range.from, range.to) : await query.limit(MAX_REPORT_ROWS);
    if (error) throw toRepositoryError(error, "Could not load payments");
    return { rows: await decorate(data ?? []), count: count ?? 0 };
  }

  return {
    async list(filter) {
      const { from, to, page, pageSize } = rangeFor(filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      const { rows, count } = await search(filter, { from, to });
      return { rows, total: count, page, pageSize };
    },

    async listAll(filter) {
      return (await search(filter)).rows;
    },

    async get(id) {
      const { data: payment, error } = await db
        .from("payments")
        .select("*")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the payment");
      if (!payment) return null;
      const [customer, allocs] = await Promise.all([
        db.from("customers").select("*").eq("id", payment.customer_id).maybeSingle(),
        db.from("payment_allocations").select("*").eq("payment_id", id),
      ]);
      const docs = await loadDocuments(db, (allocs.data ?? []).map((a) => a.document_id));
      return {
        payment,
        customer: customer.data ?? null,
        allocations: (allocs.data ?? []).map((allocation) => ({
          allocation,
          document: docs.find((d) => d.id === allocation.document_id) ?? null,
        })),
      };
    },

    async record(write) {
      const { data, error } = await db.rpc("record_payment", {
        p_customer_id: write.customer_id,
        p_payment_date: write.payment_date,
        p_amount: write.amount,
        p_currency: write.currency,
        p_method: write.method,
        p_reference: write.reference,
        p_notes: write.notes,
        p_is_adjustment: write.is_adjustment,
        p_adjustment_reason: write.adjustment_reason,
        p_allocations: write.allocations.map((a) => ({ document_id: a.document_id, amount: a.amount })),
      });
      if (error) throw toRepositoryError(error, "Could not record the payment");
      const payment = unwrap(
        await db.from("payments").select("*").eq("id", data as string).single(),
        "Could not reload the payment",
      );
      return { payment, documents: await loadDocuments(db, write.allocations.map((a) => a.document_id)) };
    },

    async void(id, reason) {
      const { data: allocs } = await db.from("payment_allocations").select("document_id").eq("payment_id", id);
      const { error } = await db.rpc("void_payment", { p_payment_id: id, p_reason: reason });
      if (error) throw toRepositoryError(error, "Could not void the payment");
      const payment = unwrap(await db.from("payments").select("*").eq("id", id).single(), "Could not reload the payment");
      return { payment, documents: await loadDocuments(db, (allocs ?? []).map((a) => a.document_id)) };
    },

    async forDocument(documentId) {
      const { data: allocs, error } = await db.from("payment_allocations").select("*").eq("document_id", documentId);
      if (error) throw toRepositoryError(error, "Could not load the payments");
      const ids = (allocs ?? []).map((a) => a.payment_id);
      if (ids.length === 0) return [];
      const { data: payments } = await db.from("payments").select("*").in("id", ids).is("voided_at", null);
      return (allocs ?? [])
        .map((allocation) => ({ allocation, payment: (payments ?? []).find((p) => p.id === allocation.payment_id) }))
        .filter((x): x is { allocation: typeof x.allocation; payment: Payment } => Boolean(x.payment))
        .sort((a, b) => b.payment.payment_date.localeCompare(a.payment.payment_date));
    },
  };
}

export function createSupabaseSettlementRepository(db: Client, ctx: RepositoryContext): SettlementRepository {
  async function reload(id: string): Promise<DocumentRow> {
    return unwrap(await db.from("documents").select("*").eq("id", id).single(), "Could not reload the invoice");
  }

  return {
    async creditLinks(filter) {
      let query = db.from("credit_note_links").select("*").eq("organization_id", ctx.organizationId);
      if (filter?.invoiceId) query = query.eq("invoice_id", filter.invoiceId);
      if (filter?.creditNoteId) query = query.eq("credit_note_id", filter.creditNoteId);
      const { data, error } = await query;
      if (error) throw toRepositoryError(error, "Could not load credit note links");
      return data ?? [];
    },

    async advanceLinks(filter) {
      let query = db.from("advance_links").select("*").eq("organization_id", ctx.organizationId);
      if (filter?.invoiceId) query = query.eq("invoice_id", filter.invoiceId);
      if (filter?.advanceId) query = query.eq("advance_document_id", filter.advanceId);
      const { data, error } = await query;
      if (error) throw toRepositoryError(error, "Could not load advance links");
      return data ?? [];
    },

    async applyCreditNote(link) {
      const { error } = await db.rpc("apply_credit_note", {
        p_credit_note_id: link.creditNoteId,
        p_invoice_id: link.invoiceId,
        p_amount: link.amount,
      });
      if (error) throw toRepositoryError(error, "Could not apply the credit note");
      return reload(link.invoiceId);
    },

    async releaseCreditNote(creditNoteId) {
      const { data: links } = await db.from("credit_note_links").select("invoice_id").eq("credit_note_id", creditNoteId);
      const { error } = await db.rpc("release_credit_note", { p_credit_note_id: creditNoteId });
      if (error) throw toRepositoryError(error, "Could not release the credit note");
      return loadDocuments(db, (links ?? []).map((l) => l.invoice_id));
    },

    async applyAdvance(link) {
      const { error } = await db.rpc("apply_advance", {
        p_advance_id: link.advanceId,
        p_invoice_id: link.invoiceId,
        p_amount: link.amount,
        p_ht_amount: link.htAmount,
        p_vat_amount: link.vatAmount,
      });
      if (error) throw toRepositoryError(error, "Could not apply the advance");
      return reload(link.invoiceId);
    },
  };
}

export function createSupabaseEmailLogRepository(db: Client, ctx: RepositoryContext): EmailLogRepository {
  return {
    async add(log) {
      return unwrap(
        await db.from("email_logs").insert({ ...log, organization_id: ctx.organizationId }).select("*").single(),
        "Could not record the email log",
      );
    },
    async listForDocument(documentId) {
      const { data, error } = await db
        .from("email_logs")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .eq("document_id", documentId)
        .order("created_at", { ascending: false });
      if (error) throw toRepositoryError(error, "Could not load the email history");
      return data ?? [];
    },
  };
}

const ATTACHMENT_BUCKET = "attachments";

export function createSupabaseAttachmentRepository(
  db: Client,
  ctx: RepositoryContext,
  adminClient?: () => Client,
): AttachmentRepository {
  const storage = () => {
    if (!adminClient) throw new RepositoryError("File storage is not configured.", "invalid");
    return adminClient().storage.from(ATTACHMENT_BUCKET);
  };

  return {
    async add(write) {
      const id = crypto.randomUUID();
      const safe = write.fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
      const storagePath = `${ctx.organizationId}/${write.entityType}/${write.entityId}/${id}-${safe}`;
      const { error: uploadError } = await storage().upload(storagePath, write.bytes, {
        contentType: write.mimeType,
        upsert: false,
      });
      if (uploadError) throw new RepositoryError(`Could not store the file: ${uploadError.message}`, "invalid");
      return unwrap(
        await db
          .from("attachments")
          .insert({
            id,
            organization_id: ctx.organizationId,
            entity_type: write.entityType,
            entity_id: write.entityId,
            storage_bucket: ATTACHMENT_BUCKET,
            storage_path: storagePath,
            file_name: write.fileName,
            mime_type: write.mimeType,
            byte_size: write.bytes.byteLength,
            uploaded_by: ctx.userId,
          })
          .select("*")
          .single(),
        "Could not record the attachment",
      );
    },

    async listFor(entityType, entityId) {
      const { data, error } = await db
        .from("attachments")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId);
      if (error) throw toRepositoryError(error, "Could not load attachments");
      return data ?? [];
    },

    async read(id) {
      const { data: attachment, error } = await db
        .from("attachments")
        .select("*")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the attachment");
      if (!attachment) return null;
      const { data, error: downloadError } = await storage().download(attachment.storage_path);
      if (downloadError || !data) return null;
      return { attachment, bytes: new Uint8Array(await data.arrayBuffer()) };
    },
  };
}

export function createSupabaseAuditRepository(db: Client, ctx: RepositoryContext): AuditRepository {
  return {
    async list({ entityIds, limit = 200 }) {
      if (entityIds.length === 0) return [];
      const { data, error } = await db
        .from("audit_logs")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .in("entity_id", entityIds)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw toRepositoryError(error, "Could not load the activity history");
      return data ?? [];
    },
  };
}
