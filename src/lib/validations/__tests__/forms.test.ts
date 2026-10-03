import { describe, expect, it } from "vitest";
import { decimalString, normalizeDecimalText, parseDecimalText } from "../common";
import { customerSchema, EMPTY_CUSTOMER } from "../customer";
import { EMPTY_ITEM, itemSchema } from "../item";
import { sequenceSchema } from "../settings";

describe("decimal text helpers", () => {
  it("normalizes spaces and decimal commas without float parsing", () => {
    expect(normalizeDecimalText("1 000 000")).toBe("1000000");
    expect(normalizeDecimalText("1\u00a0000,50")).toBe("1000.50");
    expect(parseDecimalText("12.5")).toBe("12.5");
    expect(parseDecimalText("-1")).toBeNull();
    expect(parseDecimalText("1e3")).toBeNull();
    expect(parseDecimalText("")).toBeNull();
  });

  it("decimalString enforces positivity, decimals and max", () => {
    const price = decimalString("Price", { positive: true, maxDecimals: 2, max: 1000 });
    expect(price.safeParse("10,5").data).toBe("10.5");
    expect(price.safeParse("0").success).toBe(false);
    expect(price.safeParse("1.234").success).toBe(false);
    expect(price.safeParse("1001").success).toBe(false);
    expect(price.safeParse("abc").success).toBe(false);
    expect(decimalString("D", { emptyAsZero: true }).safeParse("").data).toBe("0");
  });
});

describe("form defaults", () => {
  it("a blank customer defaults to an active company (server pages import this constant)", () => {
    expect(EMPTY_CUSTOMER.customer_type).toBe("company");
    expect(EMPTY_CUSTOMER.is_active).toBe(true);
  });

  it("a blank item is active", () => {
    expect(EMPTY_ITEM.is_active).toBe(true);
  });
});

describe("customerSchema", () => {
  const valid = { ...EMPTY_CUSTOMER, name: "Acme", country: "Cameroon", default_currency: "XAF" };

  it("accepts a company without a NIU (the NIU is only a soft warning)", () => {
    expect(customerSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a name and a valid email", () => {
    expect(customerSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...valid, email: "a@b.cm" }).success).toBe(true);
  });

  it("limits payment terms to 0-365 days and treats blank as 'use the default'", () => {
    expect(customerSchema.parse({ ...valid, payment_terms_days: "" }).payment_terms_days).toBeNull();
    expect(customerSchema.parse({ ...valid, payment_terms_days: "45" }).payment_terms_days).toBe(45);
    expect(customerSchema.safeParse({ ...valid, payment_terms_days: "400" }).success).toBe(false);
  });
});

describe("itemSchema", () => {
  it("requires a name and a non-negative price", () => {
    const base = { ...EMPTY_ITEM, name: "Website Development", unit_price: "1 000 000" };
    expect(itemSchema.safeParse(base).success).toBe(true);
    expect(itemSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...base, unit_price: "" }).data?.unit_price).toBe("0");
    expect(itemSchema.safeParse({ ...base, unit_price: "-5" }).success).toBe(false);
  });
});

describe("sequenceSchema", () => {
  it("refuses yearly reset when the year is not part of the number (would create duplicates)", () => {
    const base = { documentType: "invoice", prefix: "PS-INV", padding: 4, start_number: 0, separator: "-", include_year: false, reset_yearly: true };
    expect(sequenceSchema.safeParse(base).success).toBe(false);
    expect(sequenceSchema.safeParse({ ...base, include_year: true }).success).toBe(true);
    expect(sequenceSchema.safeParse({ ...base, reset_yearly: false }).success).toBe(true);
  });
});
