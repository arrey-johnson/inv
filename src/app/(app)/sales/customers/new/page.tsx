import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";
import { EMPTY_CUSTOMER } from "@/lib/validations/customer";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { safeInternalPath } from "@/lib/data/page";
import { param, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const ctx = await requirePermission("customers.create");
  const repo = await getRepositoryFor(ctx);
  const [org, settings] = await Promise.all([repo.organization.get(), repo.organization.getSettings()]);

  return (
    <>
      <PageHeader title="New customer" description="Add an individual or a company you invoice." />
      <CustomerForm
        defaultValues={{
          ...EMPTY_CUSTOMER,
          country: org?.country ?? EMPTY_CUSTOMER.country,
          default_currency: settings?.default_currency ?? "XAF",
        }}
        returnTo={safeInternalPath(param(search, "returnTo"))}
      />
    </>
  );
}
