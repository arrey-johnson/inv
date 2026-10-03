import { describe, expect, it } from "vitest";
import { formatDocumentNumber } from "../document-number";

const base = { separator: "-", include_year: true, padding: 4 };

describe("formatDocumentNumber", () => {
  it("formats the Promptstack sequences", () => {
    expect(formatDocumentNumber({ ...base, prefix: "PS-INV" }, 2026, 1)).toBe("PS-INV-2026-0001");
    expect(formatDocumentNumber({ ...base, prefix: "PS-PF" }, 2026, 42)).toBe("PS-PF-2026-0042");
    expect(formatDocumentNumber({ ...base, prefix: "PS-CN" }, 2027, 1234)).toBe("PS-CN-2027-1234");
    expect(formatDocumentNumber({ ...base, prefix: "PS-RCP" }, 2026, 7)).toBe("PS-RCP-2026-0007");
    expect(formatDocumentNumber({ ...base, prefix: "PS-ADV" }, 2026, 7)).toBe("PS-ADV-2026-0007");
  });

  it("never truncates counters wider than the padding", () => {
    expect(formatDocumentNumber({ ...base, prefix: "PS-INV" }, 2026, 12345)).toBe("PS-INV-2026-12345");
  });

  it("supports sequences without the year", () => {
    expect(formatDocumentNumber({ ...base, include_year: false, prefix: "X" }, 2026, 3)).toBe("X-0003");
  });

  it("rejects invalid counters", () => {
    expect(() => formatDocumentNumber({ ...base, prefix: "X" }, 2026, -1)).toThrow(RangeError);
  });
});
