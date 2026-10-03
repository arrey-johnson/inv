import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PAGE_SIZE,
  RepositoryError,
  type DocumentFilter,
  type DocumentListRow,
  type DocumentRepository,
  type DraftWrite,
  type RepositoryContext,
} from "@/lib/data/types";
import type { Database, DocumentRow } from "@/types/database";
import { rangeFor, searchTerm, stripUndefined, toRepositoryError, unwrap } from "./helpers";

type Client = SupabaseClient<Database>;

const OPEN_INVOICE_STATUSES = ["issued", "sent", "partially_paid", "overdue"] as const;
const MAX_REPORT_ROWS = 20_000;

/** The subset of the PostgREST filter builder used below (keeps the helper generic over select shapes). */
interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  gte(column: string, value: unknown): Filterable;
  lte(column: string, value: unknown): Filterable;
  gt(column: string, value: unknown): Filterable;
  lt(column: string, value: unknown): Filterable;
  or(filters: string): Filterable;
}

/**
 * @param adminClient  Optional service-role client used ONLY to write generated PDFs to the private
 *                     `documents` bucket (authenticated users have no insert policy there).
 */
export function createSupabaseDocumentRepository(
  db: Client,
  ctx: RepositoryContext,
  adminClient?: () => Client,
): DocumentRepository {
  async function writeChildren(documentId: string, write: DraftWrite) {
    if (write.items.length > 0) {
      const { error } = await db.from("document_items").insert(
        write.items.map((item) => ({ ...item, organization_id: ctx.organizationId, document_id: documentId })),
      );
      if (error) throw toRepositoryError(error, "Could not save the document lines");
    }
    if (write.withholdings.length > 0) {
      const { error } = await db.from("document_withholdings").insert(
        write.withholdings.map((w) => ({ ...w, organization_id: ctx.organizationId, document_id: documentId })),
      );
      if (error) throw toRepositoryError(error, "Could not save the document withholdings");
    }
  }

  async function applyFilters<T>(query: T, filter: Omit<DocumentFilter, "page" | "pageSize">): Promise<{ query: T }> {
    let q = query as unknown as Filterable;
    const types = [...(filter.type ? [filter.type] : []), ...(filter.types ?? [])];
    if (types.length > 0) q = q.in("document_type", types);
    if (filter.statuses?.length) q = q.in("status", filter.statuses);
    if (filter.customerId) q = q.eq("customer_id", filter.customerId);
    if (filter.dateFrom) q = q.gte("issue_date", filter.dateFrom);
    if (filter.dateTo) q = q.lte("issue_date", filter.dateTo);
    if (filter.minAmount !== undefined) q = q.gte("total_ttc", filter.minAmount);
    if (filter.maxAmount !== undefined) q = q.lte("total_ttc", filter.maxAmount);
    if (filter.overdueOnly) {
      q = q
        .in("document_type", ["invoice", "advance"])
        .in("status", [...OPEN_INVOICE_STATUSES])
        .gt("balance_due", 0)
        .lt("due_date", filter.today);
    }
    const term = searchTerm(filter.q);
    if (term) {
      const { data: matches } = await db
        .from("customers")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .ilike("name", `%${term}%`)
        .limit(50);
      const clauses = [`number.ilike.%${term}%`, `reference.ilike.%${term}%`, `subject.ilike.%${term}%`];
      if (matches?.length) clauses.push(`customer_id.in.(${matches.map((m) => m.id).join(",")})`);
      q = q.or(clauses.join(","));
    }
    return { query: q as unknown as T };
  }

  async function customerNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return names;
    const { data } = await db.from("customers").select("id, name").in("id", unique);
    for (const c of data ?? []) names.set(c.id, c.name);
    return names;
  }

  return {
    async listAll(filter) {
      let query = db.from("documents").select("*").eq("organization_id", ctx.organizationId).is("deleted_at", null);
      query = (await applyFilters(query, filter)).query;
      const { data, error } = await query
        .order("issue_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(MAX_REPORT_ROWS);
      if (error) throw toRepositoryError(error, "Could not load documents");
      const docs = data ?? [];
      const names = await customerNames(docs.map((d) => d.customer_id));
      return docs.map((d) => ({ ...d, customer_name: names.get(d.customer_id) ?? "Unknown customer" }));
    },

    async listItems(documentIds) {
      const out: Database["public"]["Tables"]["document_items"]["Row"][] = [];
      for (let i = 0; i < documentIds.length; i += 200) {
        const { data, error } = await db.from("document_items").select("*").in("document_id", documentIds.slice(i, i + 200));
        if (error) throw toRepositoryError(error, "Could not load document lines");
        out.push(...(data ?? []));
      }
      return out;
    },

    async voidDocument(id, reason) {
      const { data, error } = await db.rpc("void_document", { p_document_id: id, p_reason: reason });
      if (error) throw toRepositoryError(error, "Could not cancel the document");
      return data as DocumentRow;
    },

    async syncOverdue(today) {
      const { data, error } = await db.rpc("sync_overdue", { p_today: today });
      if (error) throw toRepositoryError(error, "Could not refresh overdue invoices");
      return Number(data ?? 0);
    },

    async setPublicLink(id, link) {
      const patch = link
        ? {
            public_token_hash: link.hash,
            public_token_created_at: link.createdAt,
            public_token_expires_at: link.expiresAt,
            public_token_revoked_at: null,
          }
        : { public_token_revoked_at: new Date().toISOString() };
      return unwrap(
        await db.from("documents").update(patch).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single(),
        "Could not update the public link",
      );
    },

    async findByTokenHash(hash) {
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .eq("public_token_hash", hash)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not look up the link");
      return data;
    },
    async list(filter) {
      const { from, to, page, pageSize } = rangeFor(filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      let query = db
        .from("documents")
        .select("*", { count: "exact" })
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null);

      query = (await applyFilters(query, filter)).query;


      const { data, error, count } = await query
        .order("issue_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw toRepositoryError(error, "Could not load documents");

      const docs = data ?? [];
      const ids = [...new Set(docs.map((d) => d.customer_id))];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: customers } = await db.from("customers").select("id, name").in("id", ids);
        for (const c of customers ?? []) names.set(c.id, c.name);
      }
      const rows: DocumentListRow[] = docs.map((d) => ({ ...d, customer_name: names.get(d.customer_id) ?? "Unknown customer" }));
      return { rows, total: count ?? 0, page, pageSize };
    },

    async get(id) {
      const { data: document, error } = await db
        .from("documents")
        .select("*")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the document");
      if (!document) return null;

      const [items, withholdings, customer] = await Promise.all([
        db.from("document_items").select("*").eq("document_id", id).order("position"),
        db.from("document_withholdings").select("*").eq("document_id", id),
        db.from("customers").select("*").eq("id", document.customer_id).maybeSingle(),
      ]);
      if (items.error) throw toRepositoryError(items.error, "Could not load the document lines");
      if (withholdings.error) throw toRepositoryError(withholdings.error, "Could not load the withholdings");
      return {
        document,
        items: items.data ?? [],
        withholdings: withholdings.data ?? [],
        customer: customer.data ?? null,
      };
    },

    async insertDraft(write) {
      const doc = unwrap(
        await db
          .from("documents")
          .insert({
            ...write.document,
            organization_id: ctx.organizationId,
            status: "draft",
            number: null,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .select("*")
          .single(),
        "Could not create the draft",
      );
      try {
        await writeChildren(doc.id, write);
      } catch (error) {
        await db.from("documents").delete().eq("id", doc.id); // drafts are deletable
        throw error;
      }
      return doc;
    },

    async replaceDraft(id, write) {
      const doc = unwrap(
        await db
          .from("documents")
          .update({ ...write.document, status: "draft", number: null, updated_by: ctx.userId })
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .eq("status", "draft")
          .select("*")
          .maybeSingle(),
        "Could not save the draft",
      );
      const removedItems = await db.from("document_items").delete().eq("document_id", id);
      if (removedItems.error) throw toRepositoryError(removedItems.error, "Could not replace the document lines");
      const removedWht = await db.from("document_withholdings").delete().eq("document_id", id);
      if (removedWht.error) throw toRepositoryError(removedWht.error, "Could not replace the withholdings");
      await writeChildren(id, write);
      return doc;
    },

    async replaceIssuedContent(id, write, snapshots) {
      const existing = unwrap(
        await db
          .from("documents")
          .select("id, status, number")
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .maybeSingle(),
        "Could not load the document",
      );
      if (!existing) throw new RepositoryError("Document not found", "not_found");
      if (existing.status === "draft") {
        throw new RepositoryError("Use the draft save path for draft documents.", "invalid");
      }
      if (existing.status === "void") {
        throw new RepositoryError("Voided documents cannot be edited.", "immutable");
      }

      const d = write.document;
      unwrap(
        await db
          .from("documents")
          .update({
            customer_id: d.customer_id,
            issue_date: d.issue_date,
            due_date: d.due_date,
            valid_until: d.valid_until,
            currency: d.currency,
            reference: d.reference,
            subject: d.subject,
            notes: d.notes,
            terms: d.terms,
            internal_notes: d.internal_notes,
            global_discount_type: d.global_discount_type,
            global_discount_value: d.global_discount_value,
            subtotal: d.subtotal,
            line_discount_total: d.line_discount_total,
            global_discount_amount: d.global_discount_amount,
            net_ht: d.net_ht,
            tax_total: d.tax_total,
            total_ttc: d.total_ttc,
            withholding_total: d.withholding_total,
            net_payable: d.net_payable,
            customer_snapshot: snapshots.customerSnapshot,
            issuer_snapshot: snapshots.issuerSnapshot,
            // Clear cached PDF so downloads regenerate after storePdf.
            pdf_storage_path: null,
            pdf_sha256: null,
            pdf_generated_at: null,
            updated_by: ctx.userId,
          })
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .neq("status", "draft")
          .neq("status", "void")
          .select("id")
          .maybeSingle(),
        "Could not save the issued document",
      );

      const removedItems = await db.from("document_items").delete().eq("document_id", id);
      if (removedItems.error) throw toRepositoryError(removedItems.error, "Could not replace the document lines");
      const removedWht = await db.from("document_withholdings").delete().eq("document_id", id);
      if (removedWht.error) throw toRepositoryError(removedWht.error, "Could not replace the withholdings");
      await writeChildren(id, write);

      const today = new Date().toISOString().slice(0, 10);
      const { error: settleError } = await db.rpc("recompute_document_settlement" as never, {
        p_document_id: id,
        p_today: today,
      } as never);
      if (settleError) throw toRepositoryError(settleError, "Could not recompute settlement after edit");

      return unwrap(
        await db.from("documents").select("*").eq("id", id).single(),
        "Could not reload the document after edit",
      );
    },

    async deleteDraft(id) {
      const { error, count } = await db
        .from("documents")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .eq("status", "draft");
      if (error) throw toRepositoryError(error, "Could not delete the draft");
      if (!count) throw new RepositoryError("Only draft documents can be deleted.", "immutable");
    },

    async patchWorkflow(id, patch) {
      return unwrap(
        await db
          .from("documents")
          .update({ ...stripUndefined(patch), updated_by: ctx.userId })
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .select("*")
          .single(),
        "Could not update the document",
      );
    },

    async issue(id) {
      const { data, error } = await db.rpc("issue_document", { p_document_id: id });
      if (error) throw toRepositoryError(error, "Could not issue the document");
      return data as DocumentRow;
    },

    async storePdf(id, pdf) {
      let storagePath: string | null = null;
      if (adminClient) {
        try {
          const path = `${ctx.organizationId}/${id}/${pdf.sha256.slice(0, 16)}.pdf`;
          const { error } = await adminClient()
            .storage.from("documents")
            .upload(path, pdf.bytes, { contentType: "application/pdf", upsert: true });
          if (error) throw new Error(error.message);
          storagePath = path;
        } catch (error) {
          // Storing the file is best-effort: the hash is still recorded and the PDF can be regenerated.
          console.error("[documents] could not upload PDF to private storage", error);
        }
      }
      const { error } = await db
        .from("documents")
        .update({ pdf_sha256: pdf.sha256, pdf_generated_at: pdf.generatedAt, pdf_storage_path: storagePath })
        .eq("id", id)
        .eq("organization_id", ctx.organizationId);
      if (error) throw toRepositoryError(error, "Could not record the PDF hash");
    },

    async link(sourceId, targetId, type) {
      const { error } = await db.from("document_links").insert({
        organization_id: ctx.organizationId,
        source_document_id: sourceId,
        target_document_id: targetId,
        link_type: type,
        created_by: ctx.userId,
      });
      if (error) throw toRepositoryError(error, "Could not link the documents");
    },

    async linksFor(id) {
      const { data, error } = await db
        .from("document_links")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .or(`source_document_id.eq.${id},target_document_id.eq.${id}`);
      if (error) throw toRepositoryError(error, "Could not load linked documents");
      return data ?? [];
    },

    async findConvertedInvoices(proformaId) {
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .eq("converted_from_document_id", proformaId)
        .eq("document_type", "invoice")
        .is("deleted_at", null);
      if (error) throw toRepositoryError(error, "Could not load converted invoices");
      return data ?? [];
    },
  };
}
