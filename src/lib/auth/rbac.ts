/**
 * Role-based access control - the single source of truth for what each role may do in the UI and
 * in server actions. The database enforces the same boundaries with RLS (00008_rls.sql); this
 * matrix keeps UX (hidden buttons / nav) and server-side checks consistent with it.
 *
 *   admin       everything, incl. settings, users, numbering, branding
 *   accountant  finance operations: invoices, credit notes, payments, reports, void; read settings
 *   sales       customers, items, proformas and draft/issued invoices (no payments, no voiding)
 *   viewer      read-only
 */
import type { UserRole } from "@/types/database";

export const PERMISSIONS = [
  "dashboard.view",

  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",

  "items.view",
  "items.create",
  "items.update",
  "items.delete",

  "proformas.view",
  "proformas.create",
  "proformas.update",
  "proformas.issue",
  "proformas.convert",

  "invoices.view",
  "invoices.create",
  "invoices.update",
  "invoices.issue",
  "invoices.send",
  "invoices.void",

  /** Approve / reject documents submitted for approval (finance roles). */
  "documents.approve",

  "credit_notes.view",
  "credit_notes.create",
  "credit_notes.issue",
  "credit_notes.void",

  "payments.view",
  "payments.create",
  "payments.void",
  /** Record an audited administrator adjustment (settlement outside the system). Admin only. */
  "payments.adjust",
  "advances.apply",

  "reports.view",
  "reports.export",

  "settings.view",
  "settings.company.manage",
  "settings.tax.manage",
  "settings.payment_methods.manage",
  "settings.branding.manage",
  "settings.numbering.manage",
  "settings.invoice_defaults.manage",
  "settings.users.manage",

  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: ReadonlyArray<Permission> = PERMISSIONS;

const SALES: ReadonlyArray<Permission> = [
  "dashboard.view",
  "customers.view",
  "customers.create",
  "customers.update",
  "items.view",
  "items.create",
  "items.update",
  "proformas.view",
  "proformas.create",
  "proformas.update",
  "proformas.issue",
  "proformas.convert",
  "invoices.view",
  "invoices.create",
  "invoices.update",
  "invoices.issue",
  "invoices.send",
  "credit_notes.view",
  "payments.view",
  "reports.view",
];

const ACCOUNTANT: ReadonlyArray<Permission> = [
  ...SALES,
  "invoices.void",
  "documents.approve",
  "credit_notes.create",
  "credit_notes.issue",
  "credit_notes.void",
  "payments.create",
  "payments.void",
  "advances.apply",
  "reports.export",
  "settings.view",
  "audit.view",
];

const VIEWER: ReadonlyArray<Permission> = [
  "dashboard.view",
  "customers.view",
  "items.view",
  "proformas.view",
  "invoices.view",
  "credit_notes.view",
  "payments.view",
  "reports.view",
];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  admin: new Set(ALL),
  accountant: new Set(ACCOUNTANT),
  sales: new Set(SALES),
  viewer: new Set(VIEWER),
};

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  admin: "Administrator",
  accountant: "Accountant",
  sales: "Sales",
  viewer: "Viewer",
};

export function hasPermission(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function hasAnyPermission(
  role: UserRole | null | undefined,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(
  role: UserRole | null | undefined,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

/** Throw `ForbiddenError` unless the role has the permission. */
export function assertPermission(role: UserRole | null | undefined, permission: Permission): void {
  if (!hasPermission(role, permission)) throw new ForbiddenError(permission);
}
