import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { FinanceCalculationError, type CalcDocumentResult } from "@/lib/finance/calculate-document";
import { RepositoryError, type DocumentBundle, type Repository } from "@/lib/data/types";
import type { OrganizationSettings, UserRole } from "@/types/database";
import { DocumentBuildError, computeResolved, type ResolvedDocument } from "./build";
import { DocumentStateError } from "./status";

export type ServiceErrorCode = "forbidden" | "invalid" | "not_found" | "conflict" | "immutable";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: ServiceErrorCode,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Who is acting. The role comes from the verified session, never from the browser. */
export interface Actor {
  role: UserRole;
}

export function need(actor: Actor, permission: Permission, message?: string): void {
  if (!hasPermission(actor.role, permission)) {
    throw new ServiceError(message ?? "You do not have permission to do this.", "forbidden");
  }
}

/** Normalize repository/domain errors into ServiceError so actions have one thing to catch. */
export function toServiceError(cause: unknown): ServiceError {
  if (cause instanceof ServiceError) return cause;
  if (cause instanceof RepositoryError) return new ServiceError(cause.message, cause.code);
  if (cause instanceof DocumentStateError) return new ServiceError(cause.message, "immutable");
  if (cause instanceof DocumentBuildError) return new ServiceError(cause.message, "invalid");
  if (cause instanceof FinanceCalculationError) return new ServiceError(cause.message, "invalid");
  throw cause;
}

/** Run the finance engine, turning calculation errors into user-facing validation errors. */
export function calculateOrThrow(doc: ResolvedDocument): CalcDocumentResult {
  try {
    return computeResolved(doc);
  } catch (cause) {
    if (cause instanceof FinanceCalculationError) throw new ServiceError(cause.message, "invalid");
    throw cause;
  }
}

export async function loadBundle(repo: Repository, id: string): Promise<DocumentBundle> {
  const bundle = await repo.documents.get(id);
  if (!bundle) throw new ServiceError("Document not found.", "not_found");
  return bundle;
}

export async function loadSettings(repo: Repository): Promise<OrganizationSettings> {
  const settings = await repo.organization.getSettings();
  if (!settings) throw new ServiceError("Organization settings are missing. Run the seed migration.", "invalid");
  return settings;
}
