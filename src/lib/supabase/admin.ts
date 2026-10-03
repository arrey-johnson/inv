import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * Use ONLY in trusted server code where there is no user session or where RLS must be bypassed
 * deliberately:
 *   - public document links (token validated first)
 *   - reading the private letterhead / stamp from storage
 *   - writing generated PDFs
 *   - system audit entries, cron jobs, webhooks
 *
 * Never import this from a Client Component; `server-only` enforces that at build time.
 * Always scope queries by organization_id manually.
 */
export function createAdminClient() {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createSupabaseClient<Database>(url, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
