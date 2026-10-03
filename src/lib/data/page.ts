import "server-only";
import { requirePermission, type AuthContext } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { getRepositoryFor } from "./index";
import type { Repository } from "./types";

/** Page preamble: signed in + permitted, with a repository bound to the actor. */
export async function requirePageRepo(permission: Permission): Promise<{ ctx: AuthContext; repo: Repository }> {
  const ctx = await requirePermission(permission);
  return { ctx, repo: await getRepositoryFor(ctx) };
}

/** Only allow same-site relative paths in `?returnTo=` style params. */
export function safeInternalPath(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : undefined;
}