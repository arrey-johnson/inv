import type { Repository } from "@/lib/data/types";
import { ServiceError } from "@/lib/documents/service-support";
import type { CurrencyCode } from "@/lib/finance/money";
import { buildCustomerStatement, type CustomerStatement } from "./build-statement";

export interface LoadedStatement {
  customer: NonNullable<Awaited<ReturnType<Repository["customers"]["get"]>>>;
  statement: CustomerStatement;
}

/** Load everything one customer's statement needs and build it. */
export async function loadCustomerStatement(
  repo: Repository,
  customerId: string,
  range: { from: string; to: string },
  currency?: CurrencyCode,
): Promise<LoadedStatement> {
  const customer = await repo.customers.get(customerId);
  if (!customer) throw new ServiceError("Customer not found.", "not_found");
  const settings = await repo.organization.getSettings();
  const chosen = currency ?? customer.default_currency ?? settings?.default_currency ?? "XAF";

  const [documents, payments] = await Promise.all([
    repo.documents.listAll({ customerId, today: range.to }),
    repo.payments.listAll({ customerId }),
  ]);
  const invoiceIds = new Set(documents.map((d) => d.id));
  const [creditLinks, advanceLinks] = await Promise.all([repo.settlement.creditLinks(), repo.settlement.advanceLinks()]);

  const statement = buildCustomerStatement({
    customer,
    currency: chosen,
    from: range.from,
    to: range.to,
    documents,
    payments,
    allocations: payments.flatMap((p) => p.allocations),
    creditLinks: creditLinks.filter((l) => invoiceIds.has(l.invoice_id)),
    advanceLinks: advanceLinks.filter((l) => invoiceIds.has(l.invoice_id)),
  });
  return { customer, statement };
}
