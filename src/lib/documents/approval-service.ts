import type { Repository } from "@/lib/data/types";
import type { DocumentRow } from "@/types/database";
import { ServiceError, loadBundle, loadSettings, need, toServiceError, type Actor } from "./service-support";
import { DOCUMENT_PERMISSIONS, assertDraft, isSalesDocumentType } from "./status";

async function loadDraftForApproval(repo: Repository, id: string) {
  const bundle = await loadBundle(repo, id);
  const doc = bundle.document;
  if (!isSalesDocumentType(doc.document_type)) throw new ServiceError("Unsupported document type.", "invalid");
  assertDraft(doc);
  const settings = await loadSettings(repo);
  if (!settings.require_approval) {
    throw new ServiceError("Approval is not required. Turn it on in Settings > Branding.", "conflict");
  }
  return doc;
}

export async function submitForApproval(repo: Repository, actor: Actor, id: string): Promise<DocumentRow> {
  try {
    const doc = await loadDraftForApproval(repo, id);
    need(actor, DOCUMENT_PERMISSIONS[doc.document_type as "invoice" | "proforma"].update);
    if (doc.approval_status === "approved") throw new ServiceError("This document is already approved.", "conflict");
    if (doc.approval_status === "pending") throw new ServiceError("This document is already waiting for approval.", "conflict");

    const updated = await repo.documents.patchWorkflow(id, {
      approval_status: "pending",
      approval_requested_by: repo.context.userId,
      approval_requested_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
      approval_note: null,
    });
    await repo.writeAudit({ action: "document.submit_approval", entityType: "document", entityId: id });
    return updated;
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export async function approveDocument(repo: Repository, actor: Actor, id: string, note?: string | null): Promise<DocumentRow> {
  try {
    need(actor, "documents.approve");
    const doc = await loadDraftForApproval(repo, id);
    if (doc.approval_status === "approved") throw new ServiceError("This document is already approved.", "conflict");

    const updated = await repo.documents.patchWorkflow(id, {
      approval_status: "approved",
      approved_by: repo.context.userId,
      approved_at: new Date().toISOString(),
      approval_note: note?.trim() || null,
    });
    await repo.writeAudit({ action: "document.approve", entityType: "document", entityId: id });
    return updated;
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export async function rejectDocument(repo: Repository, actor: Actor, id: string, note: string): Promise<DocumentRow> {
  try {
    need(actor, "documents.approve");
    if (!note.trim()) throw new ServiceError("Explain why the document is rejected.", "invalid");
    const doc = await loadDraftForApproval(repo, id);
    if (doc.approval_status !== "pending") throw new ServiceError("Only documents waiting for approval can be rejected.", "conflict");

    const updated = await repo.documents.patchWorkflow(id, {
      approval_status: "rejected",
      approved_by: null,
      approved_at: null,
      approval_note: note.trim(),
    });
    await repo.writeAudit({ action: "document.reject", entityType: "document", entityId: id, metadata: { note: note.trim() } });
    return updated;
  } catch (cause) {
    throw toServiceError(cause);
  }
}
