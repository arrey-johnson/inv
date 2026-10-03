import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CustomersTable, type CustomerRow } from "@/components/customers/customers-table";
import { CUSTOMER_TYPE_LABELS } from "@/components/customers/customer-type-badge";
import { FilterBar, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { Pagination } from "@/components/data-table/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import type { ActiveFilter } from "@/lib/data/types";
import { activeParams, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { CUSTOMER_TYPES, type CustomerType } from "@/types/database";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 20;
const FILTER_KEYS = ["q", "type", "status"] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("customers.view");

  const q = param(search, "q");
  const typeParam = param(search, "type");
  const statusParam = param(search, "status");
  const type = (CUSTOMER_TYPES as readonly string[]).includes(typeParam) ? (typeParam as CustomerType) : undefined;
  const status: ActiveFilter = statusParam === "inactive" || statusParam === "all" ? statusParam : "active";
  const page = pageParam(search);

  const result = await repo.customers.list({ q: q || undefined, type, status, page, pageSize: PAGE_SIZE });
  const rows: CustomerRow[] = result.rows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    customer_type: c.customer_type,
    niu: c.niu,
    rccm: c.rccm,
    email: c.email,
    phone: c.phone,
    city: c.city,
    is_active: c.is_active,
  }));

  return (
    <>
      <PageHeader
        title="Customers"
        description="Individuals and companies you invoice."
        actions={
          hasPermission(ctx.role, "customers.create") && (
            <Link href="/sales/customers/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" aria-hidden /> New customer
            </Link>
          )
        }
      />

      <FilterBar resetHref="/sales/customers">
        <FilterInput name="q" label="Search" value={q} placeholder="Name, email, phone, NIU, RCCM" className="min-w-64 flex-1 space-y-1" />
        <FilterSelect
          name="type"
          label="Type"
          value={type ?? ""}
          options={CUSTOMER_TYPES.map((t) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] }))}
          allLabel="All types"
        />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          allLabel="All statuses"
          allValue="all"
        />
      </FilterBar>

      <CustomersTable rows={rows} />
      <Pagination
        basePath="/sales/customers"
        params={activeParams(search, FILTER_KEYS)}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
