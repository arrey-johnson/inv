import type { Customer } from "@/types/database";

const NIU_EXPECTED_TYPES = new Set(["company", "government", "ngo"]);

/** Soft warning (never blocks saving): businesses normally have an NIU (taxpayer number). */
export function customerNiuWarning(customer: Pick<Customer, "customer_type" | "niu">): string | null {
  if (NIU_EXPECTED_TYPES.has(customer.customer_type) && !customer.niu?.trim()) {
    return "This customer is a company but has no NIU (taxpayer number). Invoices to businesses usually need it.";
  }
  return null;
}
