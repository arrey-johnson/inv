import { describe, expect, it } from "vitest";
import { companyProfileSchema } from "../organization";

describe("companyProfileSchema", () => {
  it("turns blank optional fields into null and never invents identifiers", () => {
    const parsed = companyProfileSchema.parse({
      legal_name: "  Promptstack Technologies ",
      trade_name: "",
      niu: "   ",
      rccm: "",
      country: "Cameroon",
      email: "",
    });
    expect(parsed.legal_name).toBe("Promptstack Technologies");
    expect(parsed.niu).toBeNull();
    expect(parsed.rccm).toBeNull();
    expect(parsed.trade_name).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.address_line1).toBeNull();
  });

  it("keeps provided identifiers", () => {
    const parsed = companyProfileSchema.parse({
      legal_name: "Acme",
      niu: " M123456789012X ",
      country: "Cameroon",
    });
    expect(parsed.niu).toBe("M123456789012X");
  });

  it("validates email and website", () => {
    expect(companyProfileSchema.safeParse({ legal_name: "Acme", country: "CM", email: "nope" }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ legal_name: "Acme", country: "CM", website: "example.com" }).success).toBe(false);
    expect(
      companyProfileSchema.safeParse({ legal_name: "Acme", country: "CM", email: "a@b.cm", website: "https://b.cm" })
        .success,
    ).toBe(true);
  });

  it("requires a legal name", () => {
    expect(companyProfileSchema.safeParse({ legal_name: " ", country: "CM" }).success).toBe(false);
  });
});
