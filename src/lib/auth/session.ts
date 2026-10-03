import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { USER_ROLES, type Profile, type UserRole } from "@/types/database";
import { DEMO_ORGANIZATION_ID, DEMO_USER_EMAIL, DEMO_USER_ID } from "@/lib/data/demo/state";
import { ForbiddenError, hasPermission, type Permission } from "./rbac";

/**
 * DEMO mode has no login: everyone is the demo admin (override with DEMO_ROLE=sales|accountant|viewer
 * to try the permission matrix). Never reachable unless DEMO_MODE=true.
 */
function getDemoAuthContext(): AuthContext {
  const requested = process.env.DEMO_ROLE as UserRole | undefined;
  const role: UserRole = requested && USER_ROLES.includes(requested) ? requested : "admin";
  const now = new Date().toISOString();
  const user: User = {
    id: DEMO_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: DEMO_USER_EMAIL,
    app_metadata: {},
    user_metadata: { full_name: "Demo User" },
    created_at: now,
  };
  return { user, profile: null, organizationId: DEMO_ORGANIZATION_ID, role };
}

export interface AuthContext {
  user: User;
  profile: Profile | null;
  organizationId: string;
  role: UserRole;
}

/**
 * Resolve the signed-in user, their profile and their role in one place (memoized per request).
 * Returns `null` when signed out, when Supabase is not configured, or when the account exists
 * but has not been granted a role by an admin yet.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  if (isDemoMode()) return getDemoAuthContext();
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("user_roles")
      .select("organization_id, role, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (!roles || roles.length === 0 || profile?.is_active === false) return null;

  // Prefer the organization pinned on the profile, otherwise the first granted one.
  const chosen = roles.find((r) => r.organization_id === profile?.organization_id) ?? roles[0];

  return {
    user,
    profile: profile ?? null,
    organizationId: chosen.organization_id,
    role: chosen.role,
  };
});

/** For pages and layouts under (app): redirect to /login if there is no authorized session. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * Page guard: require a permission, otherwise bounce to the dashboard.
 * For server actions / route handlers use `requirePermissionOrThrow` instead (returns 403 semantics).
 */
export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!hasPermission(ctx.role, permission)) {
    redirect("/dashboard");
  }
  return ctx;
}

/** Action / API guard: throws `ForbiddenError` (catch it and respond 403). */
export async function requirePermissionOrThrow(permission: Permission): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ForbiddenError(permission);
  if (!hasPermission(ctx.role, permission)) throw new ForbiddenError(permission);
  return ctx;
}