import { randomUUID } from "node:crypto";
import type { DocumentItemWrite, DocumentWrite, Page } from "@/lib/data/types";
import { todayISO } from "@/lib/utils/date-math";
import type { DocumentItem, DocumentRow } from "@/types/database";

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A new DRAFT row with the same defaults Postgres applies. Never carries a number. */
export function newDocumentRow(organizationId: string, write: DocumentWrite, actorId: string | null, ts: string): DocumentRow {
  const base: DocumentRow = {
    id: randomUUID(),
    organization_id: organizationId,
    document_type: write.document_type ?? "invoice",
    status: "draft",
    number: null,
    customer_id: write.customer_id,
    customer_snapshot: null,
    issuer_snapshot: null,
    issue_date: todayISO(),
    due_date: null,
    valid_until: null,
    currency: "XAF",
    reference: null,
    subject: null,
    notes: null,
    terms: null,
    internal_notes: null,
    global_discount_type: "none",
    global_discount_value: 0,
    subtotal: 0,
    line_discount_total: 0,
    global_discount_amount: 0,
    net_ht: 0,
    tax_total: 0,
    total_ttc: 0,
    withholding_total: 0,
    net_payable: 0,
    paid_amount: 0,
    credited_amount: 0,
    advance_applied_amount: 0,
    balance_due: 0,
    issued_at: null,
    issued_by: null,
    sent_at: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    converted_from_document_id: null,
    public_token_hash: null,
    public_token_created_at: null,
    public_token_expires_at: null,
    public_token_revoked_at: null,
    pdf_storage_path: null,
    pdf_sha256: null,
    pdf_generated_at: null,
    approval_status: "none",
    approval_requested_by: null,
    approval_requested_at: null,
    approved_by: null,
    approved_at: null,
    approval_note: null,
    created_by: actorId,
    updated_by: actorId,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
  // A draft is created WITHOUT a number or status, whatever the caller passed.
  return { ...base, ...defined(write), id: base.id, organization_id: organizationId, status: "draft", number: null };
}

export function newItemRow(
  organizationId: string,
  documentId: string,
  write: DocumentItemWrite,
  ts: string,
): DocumentItem {
  const base: DocumentItem = {
    id: randomUUID(),
    organization_id: organizationId,
    document_id: documentId,
    position: write.position,
    item_id: null,
    description: write.description,
    details: null,
    quantity: write.quantity,
    unit: null,
    unit_price: write.unit_price,
    discount_type: "none",
    discount_value: 0,
    tax_rate_id: null,
    tax_rate: 0,
    tax_category: "standard",
    gross_amount: 0,
    discount_amount: 0,
    net_amount: 0,
    global_discount_share: 0,
    taxable_amount: 0,
    tax_amount: 0,
    total_amount: 0,
    credit_source_item_id: null,
    created_at: ts,
    updated_at: ts,
  };
  return { ...base, ...defined(write), id: base.id, organization_id: organizationId, document_id: documentId };
}

export function paginate<T>(rows: T[], page = 1, pageSize = 20): Page<T> {
  const safePage = Math.max(1, Math.floor(page));
  const size = Math.min(200, Math.max(1, Math.floor(pageSize)));
  const start = (safePage - 1) * size;
  return { rows: rows.slice(start, start + size), total: rows.length, page: safePage, pageSize: size };
}

/** Case-insensitive "any field contains every word of q". */
export function matchesQuery(q: string | undefined, fields: ReadonlyArray<string | null | undefined>): boolean {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}
