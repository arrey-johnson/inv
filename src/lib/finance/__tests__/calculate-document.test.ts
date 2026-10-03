import { describe, expect, it } from "vitest";
import {
  FinanceCalculationError,
  calculateAdvanceBalance,
  calculateBalance,
  calculateCreditNoteCapacity,
  calculateDocument,
  maxAdvanceApplicable,
  type CalcLineInput,
} from "../calculate-document";

const VAT = 19.25;

describe("calculateDocument - VAT acceptance examples", () => {
  it("Example A: one line, 1,000,000 XAF HT at 19.25% VAT", () => {
    const result = calculateDocument({
      lines: [{ quantity: 1, unitPrice: 1_000_000, taxRate: VAT }],
    });

    expect(result.subtotal).toBe(1_000_000);
    expect(result.netHT).toBe(1_000_000);
    expect(result.taxBreakdown).toEqual([
      { rate: 19.25, taxableAmount: 1_000_000, taxAmount: 192_500 },
    ]);
    expect(result.taxTotal).toBe(192_500);
    expect(result.totalTTC).toBe(1_192_500);
    expect(result.netPayable).toBe(1_192_500);
  });

  it("Example B: VAT is computed once per rate group (not per line) and distributed exactly", () => {
    // 3 x 101 = 303 HT. Group VAT = 303 x 19.25% = 58.3275 -> 58.
    // (Rounding per line would give 3 x 19 = 57, which would not match the printed VAT summary.)
    const result = calculateDocument({
      lines: [
        { quantity: 1, unitPrice: 101, taxRate: VAT },
        { quantity: 1, unitPrice: 101, taxRate: VAT },
        { quantity: 1, unitPrice: 101, taxRate: VAT },
      ],
    });

    expect(result.taxTotal).toBe(58);
    expect(result.totalTTC).toBe(361);
    // line VAT distribution sums exactly to the group VAT, deterministic tie-break to the first line
    expect(result.lines.map((l) => l.taxAmount)).toEqual([20, 19, 19]);
    expect(result.lines.reduce((s, l) => s + l.taxAmount, 0)).toBe(58);
    expect(result.lines.reduce((s, l) => s + l.totalAmount, 0)).toBe(result.totalTTC);
  });

  it("Example C: mixed taxable + exempt lines with a global percentage discount", () => {
    const result = calculateDocument({
      lines: [
        { quantity: 1, unitPrice: 500_000, taxRate: VAT },
        { quantity: 1, unitPrice: 200_000, taxRate: 0 },
      ],
      globalDiscountType: "percentage",
      globalDiscountValue: 10,
    });

    expect(result.subtotal).toBe(700_000);
    expect(result.globalDiscountAmount).toBe(70_000);
    expect(result.lines.map((l) => l.globalDiscountShare)).toEqual([50_000, 20_000]);
    expect(result.lines.map((l) => l.taxableAmount)).toEqual([450_000, 180_000]);
    expect(result.taxBreakdown).toEqual([
      { rate: 0, taxableAmount: 180_000, taxAmount: 0 },
      { rate: 19.25, taxableAmount: 450_000, taxAmount: 86_625 },
    ]);
    expect(result.netHT).toBe(630_000);
    expect(result.taxTotal).toBe(86_625);
    expect(result.totalTTC).toBe(716_625);
  });
});

describe("calculateDocument - lines and discounts", () => {
  it("applies a percentage line discount before tax", () => {
    const result = calculateDocument({
      lines: [
        {
          quantity: 2.5,
          unitPrice: 40_000,
          discountType: "percentage",
          discountValue: 10,
          taxRate: VAT,
        },
      ],
    });
    const [line] = result.lines;
    expect(line.grossAmount).toBe(100_000);
    expect(line.discountAmount).toBe(10_000);
    expect(line.netAmount).toBe(90_000);
    expect(line.taxAmount).toBe(17_325); // 90,000 x 19.25%
    expect(result.totalTTC).toBe(107_325);
    expect(result.lineDiscountTotal).toBe(10_000);
    expect(result.discountTotal).toBe(10_000);
  });

  it("applies a fixed line discount", () => {
    const result = calculateDocument({
      lines: [
        { quantity: 4, unitPrice: 25_000, discountType: "fixed", discountValue: 15_000, taxRate: 0 },
      ],
    });
    expect(result.lines[0].netAmount).toBe(85_000);
    expect(result.totalTTC).toBe(85_000);
  });

  it("rounds XAF amounts half-up to the nearest whole franc", () => {
    const result = calculateDocument({
      lines: [{ quantity: 1.5, unitPrice: 333, taxRate: 0 }], // 499.5 -> 500
    });
    expect(result.lines[0].grossAmount).toBe(500);
    expect(result.totalTTC).toBe(500);
  });

  it("allocates a fixed global discount across lines so shares sum exactly (largest remainder)", () => {
    const lines: CalcLineInput[] = [
      { quantity: 1, unitPrice: 100, taxRate: 0 },
      { quantity: 1, unitPrice: 100, taxRate: 0 },
      { quantity: 1, unitPrice: 100, taxRate: 0 },
    ];
    const result = calculateDocument({
      lines,
      globalDiscountType: "fixed",
      globalDiscountValue: 100,
    });
    expect(result.lines.map((l) => l.globalDiscountShare)).toEqual([34, 33, 33]);
    expect(result.lines.reduce((s, l) => s + l.globalDiscountShare, 0)).toBe(100);
    expect(result.netHT).toBe(200);
    expect(result.discountTotal).toBe(100);
  });

  it("combines line and global discounts", () => {
    const result = calculateDocument({
      lines: [
        { quantity: 1, unitPrice: 100_000, discountType: "percentage", discountValue: 20, taxRate: VAT },
        { quantity: 2, unitPrice: 50_000, taxRate: VAT },
      ],
      globalDiscountType: "fixed",
      globalDiscountValue: 10_000,
    });
    // lines net: 80,000 + 100,000 = 180,000 ; global discount 10,000 -> HT 170,000
    expect(result.subtotal).toBe(180_000);
    expect(result.netHT).toBe(170_000);
    expect(result.discountTotal).toBe(30_000);
    expect(result.taxTotal).toBe(32_725); // 170,000 x 19.25% = 32,725
    expect(result.totalTTC).toBe(202_725);
  });

  it("handles an empty document", () => {
    const result = calculateDocument({ lines: [] });
    expect(result.totalTTC).toBe(0);
    expect(result.taxBreakdown).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it("supports 2-decimal currencies (EUR)", () => {
    const result = calculateDocument({
      currency: "EUR",
      lines: [{ quantity: 3, unitPrice: 33.333, taxRate: VAT }], // 99.999 -> 100.00
    });
    expect(result.lines[0].grossAmount).toBe(100);
    expect(result.taxTotal).toBe(19.25);
    expect(result.totalTTC).toBe(119.25);
  });

  it("echoes line ids", () => {
    const result = calculateDocument({
      lines: [{ id: "abc", quantity: 1, unitPrice: 10, taxRate: 0 }],
    });
    expect(result.lines[0].id).toBe("abc");
  });
});

describe("calculateDocument - withholding", () => {
  const lines: CalcLineInput[] = [{ quantity: 1, unitPrice: 1_000_000, taxRate: VAT }];

  it("computes withholding on net HT by default", () => {
    const result = calculateDocument({
      lines,
      withholdings: [{ code: "WHT-5", rate: 5 }],
    });
    expect(result.withholdings).toEqual([
      { code: "WHT-5", rate: 5, base: "net_ht", baseAmount: 1_000_000, amount: 50_000 },
    ]);
    expect(result.withholdingTotal).toBe(50_000);
    expect(result.totalTTC).toBe(1_192_500);
    expect(result.netPayable).toBe(1_142_500);
  });

  it("can compute withholding on total TTC", () => {
    const result = calculateDocument({
      lines,
      withholdings: [{ code: "WHT-5-TTC", rate: 5, base: "total_ttc" }],
    });
    expect(result.withholdingTotal).toBe(59_625); // 5% x 1,192,500
    expect(result.netPayable).toBe(1_132_875);
  });

  it("sums several withholdings", () => {
    const result = calculateDocument({
      lines,
      withholdings: [
        { code: "A", rate: 2.2 },
        { code: "B", rate: 5.5 },
      ],
    });
    expect(result.withholdingTotal).toBe(22_000 + 55_000);
  });

  it("rejects withholding above the document total", () => {
    expect(() =>
      calculateDocument({
        lines: [{ quantity: 1, unitPrice: 1000, taxRate: 0 }],
        withholdings: [
          { code: "A", rate: 60 },
          { code: "B", rate: 60 },
        ],
      }),
    ).toThrow(FinanceCalculationError);
  });
});

describe("calculateDocument - validation", () => {
  it("rejects percentage discounts above 100%", () => {
    expect(() =>
      calculateDocument({
        lines: [{ quantity: 1, unitPrice: 1000, discountType: "percentage", discountValue: 101, taxRate: 0 }],
      }),
    ).toThrow(FinanceCalculationError);
  });

  it("rejects a fixed line discount larger than the line", () => {
    expect(() =>
      calculateDocument({
        lines: [{ quantity: 1, unitPrice: 1000, discountType: "fixed", discountValue: 1001, taxRate: 0 }],
      }),
    ).toThrow(/cannot exceed/);
  });

  it("rejects a fixed global discount larger than the subtotal", () => {
    expect(() =>
      calculateDocument({
        lines: [{ quantity: 1, unitPrice: 1000, taxRate: 0 }],
        globalDiscountType: "fixed",
        globalDiscountValue: 5000,
      }),
    ).toThrow(FinanceCalculationError);
  });

  it("rejects negative quantity / price and invalid tax rates", () => {
    expect(() => calculateDocument({ lines: [{ quantity: -1, unitPrice: 10, taxRate: 0 }] })).toThrow();
    expect(() => calculateDocument({ lines: [{ quantity: 1, unitPrice: -10, taxRate: 0 }] })).toThrow();
    expect(() => calculateDocument({ lines: [{ quantity: 1, unitPrice: 10, taxRate: 120 }] })).toThrow();
  });
});

describe("calculateDocument - invariants", () => {
  // Deterministic pseudo-random generator so failures are reproducible.
  function lcg(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  it("totals always reconcile for random documents", () => {
    const rand = lcg(42);
    const rates = [0, 5, 19.25];
    for (let run = 0; run < 200; run++) {
      const lineCount = 1 + Math.floor(rand() * 8);
      const lines: CalcLineInput[] = Array.from({ length: lineCount }, () => ({
        quantity: Math.round(rand() * 2000) / 100 + 0.01,
        unitPrice: Math.floor(rand() * 500_000),
        discountType: rand() > 0.6 ? "percentage" : "none",
        discountValue: Math.floor(rand() * 30),
        taxRate: rates[Math.floor(rand() * rates.length)],
      }));
      const useGlobal = rand() > 0.5;
      const result = calculateDocument({
        lines,
        globalDiscountType: useGlobal ? "percentage" : "none",
        globalDiscountValue: useGlobal ? Math.floor(rand() * 20) : 0,
      });

      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      expect(sum(result.lines.map((l) => l.netAmount))).toBe(result.subtotal);
      expect(sum(result.lines.map((l) => l.globalDiscountShare))).toBe(result.globalDiscountAmount);
      expect(sum(result.lines.map((l) => l.taxableAmount))).toBe(result.netHT);
      expect(sum(result.lines.map((l) => l.taxAmount))).toBe(result.taxTotal);
      expect(sum(result.taxBreakdown.map((g) => g.taxAmount))).toBe(result.taxTotal);
      expect(sum(result.lines.map((l) => l.totalAmount))).toBe(result.totalTTC);
      expect(result.netHT + result.taxTotal).toBe(result.totalTTC);
      expect(Number.isInteger(result.totalTTC)).toBe(true);
    }
  });
});

describe("calculateBalance", () => {
  it("is unpaid with no settlement", () => {
    const b = calculateBalance({ netPayable: 1_142_500 });
    expect(b).toMatchObject({ balanceDue: 1_142_500, status: "unpaid", settledAmount: 0 });
  });

  it("is partially paid after payments", () => {
    const b = calculateBalance({ netPayable: 1_142_500, payments: [500_000, 100_000] });
    expect(b.paidAmount).toBe(600_000);
    expect(b.balanceDue).toBe(542_500);
    expect(b.status).toBe("partially_paid");
  });

  it("combines payments, credit notes and advances to reach paid", () => {
    const b = calculateBalance({
      netPayable: 1_000_000,
      payments: [600_000],
      creditNotes: [150_000],
      advances: [250_000],
    });
    expect(b.settledAmount).toBe(1_000_000);
    expect(b.balanceDue).toBe(0);
    expect(b.status).toBe("paid");
  });

  it("reports overpayment without a negative balance", () => {
    const b = calculateBalance({ netPayable: 100_000, payments: [120_000] });
    expect(b.balanceDue).toBe(0);
    expect(b.overpaidAmount).toBe(20_000);
    expect(b.status).toBe("overpaid");
  });
});

describe("calculateCreditNoteCapacity", () => {
  it("accepts a credit note within the remaining capacity", () => {
    const r = calculateCreditNoteCapacity({
      invoiceTotalTTC: 1_192_500,
      alreadyCredited: 192_500,
      creditNoteTotalTTC: 500_000,
    });
    expect(r).toEqual({ creditableRemaining: 1_000_000, isValid: true, remainingAfter: 500_000, excess: 0 });
  });

  it("rejects a credit note exceeding the invoice", () => {
    const r = calculateCreditNoteCapacity({
      invoiceTotalTTC: 1_192_500,
      alreadyCredited: 200_000,
      creditNoteTotalTTC: 1_000_000,
    });
    expect(r.creditableRemaining).toBe(992_500);
    expect(r.isValid).toBe(false);
    expect(r.excess).toBe(7_500);
    expect(r.remainingAfter).toBe(0);
  });

  it("a credit note built with the engine matches the invoice proportionally", () => {
    const creditNote = calculateDocument({
      lines: [{ quantity: 1, unitPrice: 100_000, taxRate: VAT }],
    });
    expect(creditNote.totalTTC).toBe(119_250);
    const r = calculateCreditNoteCapacity({
      invoiceTotalTTC: 1_192_500,
      creditNoteTotalTTC: creditNote.totalTTC,
    });
    expect(r.isValid).toBe(true);
  });
});

describe("advance balance", () => {
  it("tracks unused / partial / fully applied advances", () => {
    expect(calculateAdvanceBalance({ advanceAmount: 500_000 })).toMatchObject({
      remaining: 500_000,
      status: "unused",
    });
    expect(
      calculateAdvanceBalance({ advanceAmount: 500_000, applied: [200_000, 100_000] }),
    ).toMatchObject({ appliedAmount: 300_000, remaining: 200_000, status: "partially_applied" });
    expect(
      calculateAdvanceBalance({ advanceAmount: 500_000, applied: [400_000], refunded: [100_000] }),
    ).toMatchObject({ remaining: 0, status: "fully_applied", isOverConsumed: false });
  });

  it("flags over-consumed advances", () => {
    const r = calculateAdvanceBalance({ advanceAmount: 100_000, applied: [150_000] });
    expect(r.isOverConsumed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("limits applicable amount to the lower of advance remaining and invoice balance", () => {
    expect(maxAdvanceApplicable(200_000, 350_000)).toBe(200_000);
    expect(maxAdvanceApplicable(200_000, 50_000)).toBe(50_000);
  });
});
