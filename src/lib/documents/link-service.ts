import { defaultTokenExpiry, generateDocumentToken, getPublicLinkStatus, hashDocumentToken } from "@/lib/auth/document-token";
import type { Repository } from "@/lib/data/types";
import type { DocumentRow } from "@/types/database";
import { ServiceError, loadBundle, need, toServiceError, type Actor } from "./service-support";
import { DOCUMENT_PERMISSIONS, isSalesDocumentType } from "./status";

export interface LinkEnvironment {
  /** HMAC secret (>= 32 chars). */
  secret: string;
  /** Public base URL of the app, without a trailing slash. */
  baseUrl: string;
}

export interface CreatedLink {
  /** The raw token. Shown ONCE: only its HMAC is stored. */
  token: string;
  url: string;
  expiresAt: string | null;
}

export interface LinkSummary {
  exists: boolean;
  status: "none" | "valid" | "expired" | "revoked";
  createdAt: string | null;
  expiresAt: string | null;
}

export function summarizeLink(doc: Pick<DocumentRow, "public_token_hash" | "public_token_created_at" | "public_token_expires_at" | "public_token_revoked_at">): LinkSummary {
  if (!doc.public_token_hash) return { exists: false, status: "none", createdAt: null, expiresAt: null };
  return {
    exists: true,
    status: getPublicLinkStatus(doc),
    createdAt: doc.public_token_created_at,
    expiresAt: doc.public_token_expires_at,
  };
}

async function loadSharable(repo: Repository, actor: Actor, id: string): Promise<DocumentRow> {
  const { document } = await loadBundle(repo, id);
  if (!isSalesDocumentType(document.document_type)) throw new ServiceError("This document cannot be shared.", "invalid");
  need(actor, DOCUMENT_PERMISSIONS[document.document_type].send);
  if (document.status === "draft") throw new ServiceError("Issue the document before sharing it.", "conflict");
  return document;
}

/**
 * Create a secure public link. A new token REPLACES the previous one (the old link stops working). The
 * token is returned once and never stored, only its HMAC.
 */
export async function createPublicLink(
  repo: Repository,
  actor: Actor,
  id: string,
  env: LinkEnvironment,
  options: { expiresInDays?: number | null } = {},
): Promise<CreatedLink> {
  try {
    const document = await loadSharable(repo, actor, id);
    if (document.status === "void") throw new ServiceError("A cancelled document cannot be shared.", "conflict");

    const days = options.expiresInDays === undefined ? 90 : options.expiresInDays;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) {
      throw new ServiceError("The link validity must be between 1 and 730 days.", "invalid");
    }
    const token = generateDocumentToken();
    const now = new Date();
    const expiresAt = days === null ? null : defaultTokenExpiry(days, now).toISOString();
    await repo.documents.setPublicLink(id, { hash: hashDocumentToken(token, env.secret), createdAt: now.toISOString(), expiresAt });
    await repo.writeAudit({
      action: "document.link_create",
      entityType: "document",
      entityId: id,
      metadata: { number: document.number, expires_at: expiresAt, replaced_existing: Boolean(document.public_token_hash) },
    });
    return { token, url: `${env.baseUrl.replace(/\/$/, "")}/document/${token}`, expiresAt };
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export async function revokePublicLink(repo: Repository, actor: Actor, id: string): Promise<void> {
  try {
    const document = await loadSharable(repo, actor, id);
    if (!document.public_token_hash) throw new ServiceError("This document has no public link.", "conflict");
    await repo.documents.setPublicLink(id, null);
    await repo.writeAudit({
      action: "document.link_revoke",
      entityType: "document",
      entityId: id,
      metadata: { number: document.number },
    });
  } catch (cause) {
    throw toServiceError(cause);
  }
}
