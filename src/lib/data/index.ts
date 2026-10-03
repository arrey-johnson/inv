import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { getServerEnv, isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { createDemoRepository } from "./demo/demo-repository";
import { createSupabaseRepository } from "./supabase/supabase-repository";
import type { Repository } from "./types";

export * from "./types";

/** Service-role client for private PDF storage, only when the server secrets are configured. */
function pdfStorageClient(): (() => SupabaseClient<Database>) | undefined {
  try {
    getServerEnv();
    return () => createAdminClient();
  } catch {
    return undefined;
  }
}

/** Repository bound to an already-resolved auth context (demo store or the signed-in user's RLS client). */
export async function getRepositoryFor(ctx: AuthContext): Promise<Repository> {
  const context = { organizationId: ctx.organizationId, userId: ctx.user.id, userEmail: ctx.user.email ?? null };
  if (isDemoMode()) return createDemoRepository(undefined, context);
  return createSupabaseRepository(await createClient(), context, { adminClient: pdfStorageClient() });
}

/** Repository for the signed-in user. Returns null when signed out (callers decide how to respond). */
export async function getRepository(): Promise<Repository | null> {
  const ctx = await getAuthContext();
  return ctx ? getRepositoryFor(ctx) : null;
}