import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertPermission,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from "../rbac";

describe("rbac matrix", () => {
  it("admin has every permission", () => {
    for (const p of PERMISSIONS) expect(hasPermission("admin", p)).toBe(true);
  });

  it("nobody (no role) has any permission", () => {
    for (const p of PERMISSIONS) expect(hasPermission(null, p)).toBe(false);
    expect(hasPermission(undefined, "dashboard.view")).toBe(false);
  });

  it("viewer is strictly read-only", () => {
    for (const p of ROLE_PERMISSIONS.viewer) {
      expect(p.endsWith(".view")).toBe(true);
    }
    expect(hasPermission("viewer", "invoices.create")).toBe(false);
    expect(hasPermission("viewer", "reports.export")).toBe(false);
  });

  it("sales can prepare documents but not take payments, void or touch settings", () => {
    expect(hasPermission("sales", "invoices.create")).toBe(true);
    expect(hasPermission("sales", "proformas.convert")).toBe(true);
    expect(hasPermission("sales", "payments.create")).toBe(false);
    expect(hasPermission("sales", "invoices.void")).toBe(false);
    expect(hasPermission("sales", "settings.view")).toBe(false);
  });

  it("accountant handles money but cannot manage users or branding", () => {
    expect(hasPermission("accountant", "payments.create")).toBe(true);
    expect(hasPermission("accountant", "credit_notes.issue")).toBe(true);
    expect(hasPermission("accountant", "invoices.void")).toBe(true);
    expect(hasPermission("accountant", "settings.view")).toBe(true);
    expect(hasPermission("accountant", "settings.users.manage")).toBe(false);
    expect(hasPermission("accountant", "settings.branding.manage")).toBe(false);
  });

  it("only admins manage settings", () => {
    const manage = PERMISSIONS.filter((p) => p.endsWith(".manage"));
    expect(manage.length).toBeGreaterThan(0);
    for (const p of manage) {
      expect(hasPermission("admin", p)).toBe(true);
      for (const role of ["accountant", "sales", "viewer"] as const) {
        expect(hasPermission(role, p)).toBe(false);
      }
    }
  });

  it("every role's permissions are valid permission names", () => {
    const valid = new Set<string>(PERMISSIONS);
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const p of perms) expect(valid.has(p)).toBe(true);
    }
  });

  it("any/all helpers and assertPermission", () => {
    expect(hasAnyPermission("viewer", ["invoices.create", "invoices.view"])).toBe(true);
    expect(hasAllPermissions("viewer", ["invoices.create", "invoices.view"])).toBe(false);
    expect(() => assertPermission("viewer", "payments.create")).toThrow(ForbiddenError);
    expect(() => assertPermission("admin", "payments.create")).not.toThrow();
  });
});
