import "server-only";
import { findDocumentByTokenHash, getDocumentLinkSecret } from "./public-access";
import type { DocumentRow } from "@/types/database";
import {
  getPublicLinkStatus,
  hashDocumentToken,
  isWellFormedDocumentToken,
  type PublicLinkStatus,
} from "./document-token";

export type PublicDocumentResult =
  | { ok: true; document: DocumentRow }
  | { ok: false; reason: "invalid" | "not_found" | PublicLinkStatus };

/**
 * Resolve a public token to a document using the service role (the visitor has no session).
 * Only issued documents can be opened; drafts are never exposed. Every failure mode returns the same
 * generic outcome to the visitor (see the page) so tokens cannot be probed for existence.
 */
export async function resolvePublicDocument(token: string): Promise<PublicDocumentResult> {
  if (!isWellFormedDocumentToken(token)) return { ok: false, reason: "invalid" };

  let document: DocumentRow | null = null;
  try {
    document = await findDocumentByTokenHash(hashDocumentToken(token, getDocumentLinkSecret()));
  } catch (error) {
    // Misconfiguration or a database outage must not leak details to an anonymous visitor.
    console.error("[public-link] lookup failed", error);
    return { ok: false, reason: "not_found" };
  }

  if (!document) return { ok: false, reason: "not_found" };
  if (document.status === "draft") return { ok: false, reason: "not_found" };

  const linkStatus = getPublicLinkStatus(document);
  if (linkStatus !== "valid") return { ok: false, reason: linkStatus };

  return { ok: true, document };
}
