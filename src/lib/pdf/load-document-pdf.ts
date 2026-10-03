import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRepository } from "@/lib/data/supabase/supabase-repository";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import { DocumentPdfError, renderRepositoryDocumentPdf, type RenderedDocumentPdf } from "./render-document";

export { DocumentPdfError };
export type { RenderedDocumentPdf };

/**
 * Render a stored document through a Supabase client. The supplied client decides authorization:
 * pass the user-scoped client for the signed-in app (RLS applies) or the admin client AFTER validating
 * a public token. `organizationId` is required: every query is scoped to it.
 */
export async function renderStoredDocumentPdf(
  supabase: SupabaseClient<Database>,
  documentId: string,
  options: { organizationId: string },
): Promise<RenderedDocumentPdf> {
  const repo = createSupabaseRepository(supabase, {
    organizationId: options.organizationId,
    userId: null,
    userEmail: null,
  });
  return renderRepositoryDocumentPdf(repo, documentId);
}

export function appBaseUrl(): string {
  return publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}
