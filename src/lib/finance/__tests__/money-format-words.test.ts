import { describe, expect, it } from "vitest";
import { amountInWordsXAF, integerToWords } from "../amount-in-words";
import { formatMoney, formatNumber, formatPercent, formatQuantity, formatXAF } from "../format";
import { allocateProportionally, roundMoney, roundXAF, sumDecimals } from "../money";

describe("money", () => {
  it("rounds XAF half-up to whole francs", () => {
    expect(roundXAF(0.5).toNumber()).toBe(1);
    expect(roundXAF(1.4999).toNumber()).toBe(1);
    expect(roundXAF(2.5).toNumber()).toBe(3);
    expect(roundXAF("192.3075").toNumber()).toBe(192);
  });

  it("rounds EUR to cents", () => {
    expect(roundMoney("1.005", "EUR").toNumber()).toBe(1.01);
  });

  it("avoids binary floating point errors", () => {
    expect(sumDecimals([0.1, 0.2]).toNumber()).toBe(0.3);
  });

  it("allocates exactly with largest remainder", () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.map((p) => p.toNumber())).toEqual([34, 33, 33]);
    const weighted = allocateProportionally(10, [1, 2, 7]);
    expect(weighted.map((p) => p.toNumber())).toEqual([1, 2, 7]);
    expect(allocateProportionally(10, [0, 0]).map((p) => p.toNumber())).toEqual([0, 0]);
  });

  it("rejects negative allocation totals and weights", () => {
    expect(() => allocateProportionally(-1, [1])).toThrow();
    expect(() => allocateProportionally(1, [-1, 2])).toThrow();
  });
});

describe("format", () => {
  it("formats XAF with thousands separators and FCFA", () => {
    expect(formatXAF(1_000_000)).toBe("1,000,000 FCFA");
    expect(formatXAF(0)).toBe("0 FCFA");
    expect(formatXAF(999)).toBe("999 FCFA");
    expect(formatXAF(1_192_500)).toBe("1,192,500 FCFA");
    expect(formatXAF(-1500)).toBe("-1,500 FCFA");
    expect(formatXAF(null)).toBe("0 FCFA");
  });

  it("rounds before formatting", () => {
    expect(formatXAF(1234.5)).toBe("1,235 FCFA");
  });

  it("formats other currencies with 2 decimals", () => {
    expect(formatMoney(1234.5, "EUR")).toBe("1,234.50 EUR");
    expect(formatNumber(1_000_000)).toBe("1,000,000");
  });

  it("formats percentages and quantities", () => {
    expect(formatPercent(19.25)).toBe("19.25%");
    expect(formatPercent(5)).toBe("5%");
    expect(formatQuantity(2.5)).toBe("2.5");
    expect(formatQuantity(1200)).toBe("1,200");
  });
});

describe("amount in words (XAF)", () => {
  it("converts integers", () => {
    expect(integerToWords(0)).toBe("Zero");
    expect(integerToWords(13)).toBe("Thirteen");
    expect(integerToWords(21)).toBe("Twenty-One");
    expect(integerToWords(100)).toBe("One Hundred");
    expect(integerToWords(1001)).toBe("One Thousand One");
    expect(integerToWords(1_250_000)).toBe("One Million Two Hundred Fifty Thousand");
  });

  it("builds the document sentence", () => {
    expect(amountInWordsXAF(1_192_500)).toBe(
      "One Million One Hundred Ninety-Two Thousand Five Hundred Central African CFA Francs Only",
    );
    expect(amountInWordsXAF(1)).toBe("One Central African CFA Franc Only");
    expect(amountInWordsXAF(0)).toBe("Zero Central African CFA Francs Only");
    expect(amountInWordsXAF(1000.4)).toBe("One Thousand Central African CFA Francs Only");
  });
});
