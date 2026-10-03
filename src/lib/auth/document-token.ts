/**
 * Secure public document links (`/document/[token]`).
 *
 * - The token is 256 bits of CSPRNG output, base64url encoded (43 chars). It is shown ONCE (when the
 *   link is created) and never stored: the database keeps only `HMAC-SHA256(token, secret)`.
 *   A database leak therefore does not reveal usable links.
 * - Links can expire and be revoked (`public_token_expires_at`, `public_token_revoked_at`).
 */
import { createHmac, randomBytes } from "node:crypto";

export const DOCUMENT_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateDocumentToken(): string {
  return randomBytes(DOCUMENT_TOKEN_BYTES).toString("base64url");
}

/** Cheap shape check so malformed tokens never reach the database. */
export function isWellFormedDocumentToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function hashDocumentToken(token: string, secret: string): string {
  if (secret.length < 32) throw new Error("Document link secret must be at least 32 characters");
  return createHmac("sha256", secret).update(token).digest("hex");
}

export interface PublicLinkState {
  public_token_expires_at: string | null;
  public_token_revoked_at: string | null;
}

export type PublicLinkStatus = "valid" | "expired" | "revoked";

export function getPublicLinkStatus(link: PublicLinkState, now: Date = new Date()): PublicLinkStatus {
  if (link.public_token_revoked_at) return "revoked";
  if (link.public_token_expires_at && new Date(link.public_token_expires_at).getTime() <= now.getTime()) {
    return "expired";
  }
  return "valid";
}

export function defaultTokenExpiry(days = 90, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
