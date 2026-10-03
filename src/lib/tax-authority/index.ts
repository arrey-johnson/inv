import type { SubmissionStatus } from "@/types/database";

/**
 * Tax authority (DGI, Cameroon) e-invoicing hook - FUTURE.
 *
 * The `tax_authority_submissions` table already exists. Once the official API specification and
 * credentials are available, implement `TaxAuthorityAdapter` and register it in `getTaxAuthorityAdapter`.
 * Until then submissions are never attempted, and nothing in the app depends on this module.
 */
export interface TaxSubmissionRequest {
  documentId: string;
  documentNumber: string;
  payload: Record<string, unknown>;
}

export interface TaxSubmissionOutcome {
  status: Extract<SubmissionStatus, "submitted" | "accepted" | "rejected" | "failed">;
  externalReference?: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface TaxAuthorityAdapter {
  readonly authority: string;
  submit(request: TaxSubmissionRequest): Promise<TaxSubmissionOutcome>;
}

export const TAX_AUTHORITY_ENABLED = false;

export function getTaxAuthorityAdapter(): TaxAuthorityAdapter | null {
  return null; // not integrated yet
}
