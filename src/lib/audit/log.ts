import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/** Dotted `entity.verb` action names. Extend as features land; keep them stable (they are queried). */
export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "customer.create"
  | "customer.update"
  | "customer.delete"
  | "item.create"
  | "item.update"
  | "item.delete"
  | "document.create"
  | "document.update"
  | "document.amend"
  | "document.issue"
  | "document.send"
  | "document.view_public"
  | "document.download_pdf"
  | "document.void"
  | "document.convert"
  | "document.delete_draft"
  | "document.duplicate"
  | "document.submit_approval"
  | "document.approve"
  | "document.reject"
  | "document.pdf_stored"
  | "customer.deactivate"
  | "item.seed_catalog"
  | "document.link_create"
  | "document.link_revoke"
  | "payment.create"
  | "payment.allocate"
  | "payment.void"
  | "payment.adjust"
  | "document.accept"
  | "document.decline"
  | "document.expire"
  | "document.email"
  | "credit_note.create"
  | "credit_note.apply"
  | "advance.apply"
  | "report.export"
  | "statement.download"
  | "settings.withholding.update"
  | "settings.company.update"
  | "settings.tax.update"
  | "settings.payment_methods.update"
  | "settings.branding.update"
  | "settings.numbering.update"
  | "settings.invoice_defaults.update"
  | "user.invite"
  | "user.role_change"
  | "user.deactivate";

export interface AuditEntry {
  organizationId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  before?: Json | null;
  after?: Json | null;
  metadata?: Record<string, Json | undefined>;
}

/** Keys that must never be persisted in audit snapshots. */
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "service_role_key",
  "public_token_hash",
  "secret",
]);

/** Deep-clone a value into JSON, dropping sensitive keys. */
export function sanitizeForAudit(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return value as Json;
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v)) as Json;
  const out: { [key: string]: Json | undefined } = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
    } else {
      out[key] = sanitizeForAudit(val) ?? null;
    }
  }
  return out;
}

async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null }; // outside a request scope (scripts, cron)
  }
}

/**
 * Append an audit record.
 *
 * Pass the user-scoped client from `createClient()` for user actions (RLS verifies the actor),
 * or the admin client for system events. Auditing must never break the business operation, so
 * failures are logged and swallowed unless `strict` is set (use strict for security-critical
 * events such as role changes where "no audit trail" must abort the action).
 */
export async function writeAuditLog(
  supabase: SupabaseClient<Database>,
  entry: AuditEntry,
  options: { strict?: boolean } = {},
): Promise<void> {
  const { ip, userAgent } = await requestContext();

  const { error } = await supabase.from("audit_logs").insert({
    organization_id: entry.organizationId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    actor_id: entry.actorId ?? null,
    actor_email: entry.actorEmail ?? null,
    before_data: sanitizeForAudit(entry.before),
    after_data: sanitizeForAudit(entry.after),
    metadata: (sanitizeForAudit(entry.metadata ?? {}) ?? {}) as Json,
    ip_address: ip,
    user_agent: userAgent?.slice(0, 500) ?? null,
  });

  if (error) {
    console.error("[audit] failed to write audit log", { action: entry.action, error: error.message });
    if (options.strict) throw new Error(`Audit log write failed: ${error.message}`);
  }
}
