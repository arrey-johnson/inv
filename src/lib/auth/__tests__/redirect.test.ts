import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site relative paths", () => {
    expect(safeRedirectPath("/sales/invoices?status=paid")).toBe("/sales/invoices?status=paid");
  });

  it("rejects external / protocol-relative / backslash tricks", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "/a\nb"]) {
      expect(safeRedirectPath(bad)).toBe("/dashboard");
    }
  });

  it("falls back for non-strings", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/x")).toBe("/x");
  });
});
