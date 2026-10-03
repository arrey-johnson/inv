import { describe, expect, it } from "vitest";
import {
  defaultTokenExpiry,
  generateDocumentToken,
  getPublicLinkStatus,
  hashDocumentToken,
  isWellFormedDocumentToken,
} from "../document-token";

const SECRET = "x".repeat(40);

describe("document tokens", () => {
  it("generates unique, well-formed 256-bit tokens", () => {
    const a = generateDocumentToken();
    const b = generateDocumentToken();
    expect(a).not.toBe(b);
    expect(isWellFormedDocumentToken(a)).toBe(true);
    expect(a).toHaveLength(43);
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "short", "a".repeat(44), "../../etc/passwd", `${"a".repeat(42)}!`, 123, null, undefined]) {
      expect(isWellFormedDocumentToken(bad)).toBe(false);
    }
  });

  it("hashes deterministically and depends on the secret", () => {
    const token = generateDocumentToken();
    expect(hashDocumentToken(token, SECRET)).toBe(hashDocumentToken(token, SECRET));
    expect(hashDocumentToken(token, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDocumentToken(token, SECRET)).not.toBe(hashDocumentToken(token, "y".repeat(40)));
    expect(hashDocumentToken(token, SECRET)).not.toBe(token);
  });

  it("refuses weak secrets", () => {
    expect(() => hashDocumentToken("t", "short")).toThrow();
  });

  it("evaluates expiry and revocation", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(getPublicLinkStatus({ public_token_expires_at: null, public_token_revoked_at: null }, now)).toBe("valid");
    expect(
      getPublicLinkStatus({ public_token_expires_at: "2026-10-03T00:00:00Z", public_token_revoked_at: null }, now),
    ).toBe("valid");
    expect(
      getPublicLinkStatus({ public_token_expires_at: "2026-10-01T00:00:00Z", public_token_revoked_at: null }, now),
    ).toBe("expired");
    expect(
      getPublicLinkStatus({ public_token_expires_at: null, public_token_revoked_at: "2026-10-01T00:00:00Z" }, now),
    ).toBe("revoked");
    expect(defaultTokenExpiry(1, now).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });
});
