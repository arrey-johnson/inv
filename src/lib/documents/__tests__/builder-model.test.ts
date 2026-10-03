import { describe, expect, it } from "vitest";
import {
  computeBuilderTotals,
  dueDateFromTerms,
  emptyLine,
  newBuilderState,
  toDocumentPayload,
  type BuilderTaxRate,
} from "../builder-model";
import { documentInputSchema } from "../schema";

const vat: BuilderTaxRate = { id: "vat", name: "Standard VAT", rate: 19.25, category: "vat", is_active: true };
const exempt: BuilderTaxRate = { id: "ex", name: "Exempt", rate: 0, category: "exempt", is_active: true };

const websiteLine = (over: Partial<ReturnType<typeof emptyLine>> = {}) => ({
  ...emptyLine("vat"),
  description: "Website Development",
  unitPrice: "1000000",
  ...over,
});

describe("computeBuilderTotals (live preview)", () => {
  it("1,000,000 HT at 19.25% VAT = 192,500 / 1,192,500", () => {
    const t = computeBuilderTotals(
      { currency: "XAF", lines: [websiteLine()], globalDiscountType: "none", globalDiscountValue: "0" },
      [vat, exempt],
      true,
    );
    expect(t.calc?.taxTotal).toBe(192_500);
    expect(t.calc?.totalTTC).toBe(1_192_500);
    expect(t.incompleteLines).toEqual([]);
  });

  it("10% global discount = 173,250 VAT / 1,073,250 TTC", () => {
    const t = computeBuilderTotals(
      { currency: "XAF", lines: [websiteLine()], globalDiscountType: "percentage", globalDiscountValue: "10" },
      [vat],
      true,
    );
    expect(t.calc?.netHT).toBe(900_000);
    expect(t.calc?.taxTotal).toBe(173_250);
    expect(t.calc?.totalTTC).toBe(1_073_250);
  });

  it("accepts typed formats: spaces and decimal commas", () => {
    const t = computeBuilderTotals(
      {
        currency: "XAF",
        lines: [websiteLine({ unitPrice: "1 000 000", quantity: "1,5" })],
        globalDiscountType: "none",
        globalDiscountValue: "",
      },
      [exempt],
      true,
    );
    expect(t.calc?.subtotal).toBe(1_500_000);
  });

  it("ignores VAT entirely when VAT is disabled", () => {
    const t = computeBuilderTotals(
      { currency: "XAF", lines: [websiteLine()], globalDiscountType: "none", globalDiscountValue: "0" },
      [vat],
      false,
    );
    expect(t.calc?.taxTotal).toBe(0);
    expect(t.calc?.totalTTC).toBe(1_000_000);
  });

  it("flags incomplete lines instead of throwing", () => {
    const t = computeBuilderTotals(
      {
        currency: "XAF",
        lines: [websiteLine(), websiteLine({ quantity: "abc" }), websiteLine({ quantity: "0" })],
        globalDiscountType: "none",
        globalDiscountValue: "0",
      },
      [vat],
      true,
    );
    expect(t.incompleteLines).toEqual([2, 3]);
    expect(t.calc?.totalTTC).toBe(1_192_500);
    expect(t.lineResults[0]).not.toBeNull();
    expect(t.lineResults[1]).toBeNull();
  });

  it("reports an error for a discount larger than the subtotal", () => {
    const t = computeBuilderTotals(
      { currency: "XAF", lines: [websiteLine()], globalDiscountType: "fixed", globalDiscountValue: "2000000" },
      [vat],
      true,
    );
    expect(t.calc).toBeNull();
    expect(t.error).toBeTruthy();
  });
});

describe("builder state helpers", () => {
  it("payment terms drive the due date", () => {
    expect(dueDateFromTerms("2026-10-02", "30")).toBe("2026-11-01");
    expect(dueDateFromTerms("2026-10-02", "0")).toBe("2026-10-02");
    expect(dueDateFromTerms("2026-10-02", "abc")).toBeNull();
    expect(dueDateFromTerms("not-a-date", "30")).toBeNull();
  });

  it("new invoice defaults: issue date today, due = today + terms; proforma uses validity", () => {
    const base = { today: "2026-10-02", currency: "XAF" as const, paymentTermsDays: 30, validityDays: 15, notes: null, terms: null };
    const invoice = newBuilderState({ ...base, documentType: "invoice" });
    expect(invoice.issueDate).toBe("2026-10-02");
    expect(invoice.dueDate).toBe("2026-11-01");
    const proforma = newBuilderState({ ...base, documentType: "proforma" });
    expect(proforma.validUntil).toBe("2026-10-17");
    expect(proforma.dueDate).toBe("");
  });

  it("the payload built by the editor passes the server schema", () => {
    const state = {
      ...newBuilderState({
        documentType: "proforma",
        today: "2026-10-02",
        currency: "XAF",
        paymentTermsDays: 30,
        validityDays: 30,
        notes: null,
        terms: null,
        customerId: "11111111-1111-4111-8111-111111111111",
      }),
      lines: [websiteLine({ taxRateId: "22222222-2222-4222-8222-222222222222" })],
    };
    const parsed = documentInputSchema.safeParse(toDocumentPayload("proforma", state));
    expect(parsed.success).toBe(true);
  });
});
