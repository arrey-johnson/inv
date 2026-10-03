import "server-only";
import { writeAuditLog, type AuditAction } from "@/lib/audit/log";
import { createDemoRepository } from "@/lib/data/demo/demo-repository";
import { getServerEnv, isDemoMode } from "@/lib/env";
import { DocumentPdfError, renderStoredDocumentPdf } from "@/lib/pdf/load-document-pdf";
import { renderRepositoryDocumentPdf, type RenderedDocumentPdf } from "@/lib/pdf/render-document";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentRow, Json } from "@/types/database";

/**
 * Demo mode has no secrets configured by design. A fixed fallback keeps secure links working locally; it
 * is only ever used when `DEMO_MODE=true` AND no `DOCUMENT_LINK_SECRET` is set, so a production
 * deployment can never fall back to it.
 */
const DEMO_FALLBACK_SECRET = "demo-mode-only-document-link-secret-do-not-use-in-production";

export function getDocumentLinkSecret(): string {
  const configured = process.env.DOCUMENT_LINK_SECRET;
  if (isDemoMode() && (!configured || configured.length < 32)) return DEMO_FALLBACK_SECRET;
  return getServerEnv().DOCUMENT_LINK_SECRET;
}

/** Look a document up by the hash of its public token, without a user session. */
export async function findDocumentByTokenHash(hash: string): Promise<DocumentRow | null> {
  if (isDemoMode()) return createDemoRepository().documents.findByTokenHash(hash);
  const { data, error } = await createAdminClient()
    .from("documents")
    .select("*")
    .eq("public_token_hash", hash)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Audit an anonymous visit (no actor). Failures are logged, never thrown. */
export async function writePublicAudit(
  document: Pick<DocumentRow, "id" | "organization_id" | "number">,
  action: AuditAction,
  metadata: Record<string, Json | undefined> = {},
): Promise<void> {
  try {
    if (isDemoMode()) {
      await createDemoRepository(undefined, {
        organizationId: document.organization_id,
        userId: null,
        userEmail: null,
      }).writeAudit({
        action,
        entityType: "document",
        entityId: document.id,
        metadata: { number: document.number, ...metadata },
      });
      return;
    }
    await writeAuditLog(createAdminClient(), {
      organizationId: document.organization_id,
      action,
      entityType: "document",
      entityId: document.id,
      metadata: { number: document.number, ...metadata },
    });
  } catch (error) {
    console.error("[public-link] could not write audit entry", error);
  }
}

export async function renderPublicPdf(document: Pick<DocumentRow, "id" | "organization_id">): Promise<RenderedDocumentPdf> {
  if (isDemoMode()) return renderRepositoryDocumentPdf(createDemoRepository(), document.id);
  return renderStoredDocumentPdf(createAdminClient(), document.id, { organizationId: document.organization_id });
}

export { DocumentPdfError };
