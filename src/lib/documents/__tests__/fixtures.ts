import { createDemoRepository, DEMO_CONTEXT } from "@/lib/data/demo/demo-repository";
import { MemoryDemoStore } from "@/lib/data/demo/store";
import type { CustomerWrite, Repository } from "@/lib/data/types";
import { todayISO } from "@/lib/utils/date-math";
import type { Customer, TaxRate } from "@/types/database";
import { documentInputSchema, type DocumentInput, type DocumentInputRaw } from "../schema";

export function makeRepository(): { repo: Repository; store: MemoryDemoStore } {
  const store = new MemoryDemoStore();
  return { repo: createDemoRepository(store, DEMO_CONTEXT), store };
}

export const customerWrite = (overrides: Partial<CustomerWrite> = {}): CustomerWrite => ({
  customer_type: "company",
  code: null,
  name: "Acme Cameroon SARL",
  contact_name: null,
  email: "billing@acme.test",
  phone: null,
  address_line1: "Rue de la Joie",
  address_line2: null,
  city: "Douala",
  region: null,
  country: "Cameroon",
  niu: "TEST-NIU-001",
  rccm: null,
  default_currency: "XAF",
  payment_terms_days: null,
  default_withholding_type_id: null,
  notes: null,
  is_active: true,
  ...overrides,
});

export async function seedCustomer(repo: Repository, overrides: Partial<CustomerWrite> = {}): Promise<Customer> {
  return repo.customers.create(customerWrite(overrides));
}

export async function standardVat(repo: Repository): Promise<TaxRate> {
  const rates = await repo.taxes.listRates();
  const rate = rates.find((r) => r.code === "VAT_STD");
  if (!rate) throw new Error("seed is missing VAT_STD");
  return rate;
}

/** Website Development, 1,000,000 HT, 19.25% VAT - the acceptance-criteria line. */
export function parseInput(raw: Partial<DocumentInputRaw> & Pick<DocumentInputRaw, "customerId">, taxRateId: string | null): DocumentInput {
  return documentInputSchema.parse({
    documentType: "proforma",
    issueDate: todayISO(),
    currency: "XAF",
    globalDiscountType: "none",
    globalDiscountValue: "0",
    lines: [
      {
        description: "Website Development",
        quantity: "1",
        unitPrice: "1000000",
        discountType: "none",
        discountValue: "0",
        taxRateId,
      },
    ],
    ...raw,
  });
}
