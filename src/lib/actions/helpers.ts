import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, hasPermission, type Permission } from "@/lib/auth/rbac";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { RepositoryError, type Repository } from "@/lib/data/types";
import { ServiceError } from "@/lib/documents/service-support";
import { fieldErrorsFromZod } from "@/lib/validations/common";

export type ActionFailure = {
  ok: false;
  error: string;
  /** Extra lines (e.g. every reason a document cannot be issued). */
  details?: string[];
  /** `{ "lines.0.quantity": "message" }` */
  fieldErrors?: Record<string, string>;
};
export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export const succeed = <T>(data: T): ActionSuccess<T> => ({ ok: true, data });

export function failure(error: unknown): ActionFailure {
  if (error instanceof ServiceError) return { ok: false, error: error.message, details: error.details };
  if (error instanceof RepositoryError) return { ok: false, error: error.message };
  if (error instanceof ForbiddenError) return { ok: false, error: "You do not have permission to do this." };
  console.error("[action] unexpected error", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export function invalidInput(error: z.ZodError): ActionFailure {
  const fieldErrors = fieldErrorsFromZod(error);
  const first = Object.values(fieldErrors)[0];
  return { ok: false, error: first ?? "Please fix the highlighted fields.", fieldErrors };
}

export interface ActionContext {
  ctx: AuthContext;
  repo: Repository;
}

/**
 * Standard preamble for every mutating server action:
 * session -> permission (server side, never trust the UI) -> repository bound to the actor.
 */
export async function authorize(...permissions: Permission[]): Promise<ActionContext | ActionFailure> {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, error: "Your session has expired. Please sign in again." };
  for (const permission of permissions) {
    if (!hasPermission(ctx.role, permission)) {
      return { ok: false, error: "You do not have permission to do this." };
    }
  }
  return { ctx, repo: await getRepositoryFor(ctx) };
}

export function isFailure(value: ActionContext | ActionFailure): value is ActionFailure {
  return "ok" in value;
}

/** Revalidate the pages that show sales data. */
export function revalidateSales(): void {
  revalidatePath("/sales", "layout");
  revalidatePath("/dashboard");
}
