import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { Pagination } from "@/components/data-table/pagination";
import { ItemsTable, type ItemRow } from "@/components/items/items-table";
import { SeedCatalogButton } from "@/components/items/seed-catalog-button";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import type { ActiveFilter } from "@/lib/data/types";
import { formatPercent } from "@/lib/finance/format";
import { activeParams, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { ITEM_TYPES, type ItemType } from "@/types/database";

export const metadata: Metadata = { title: "Products & services" };

const PAGE_SIZE = 20;

export default async function ItemsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("items.view");

  const q = param(search, "q");
  const typeParam = param(search, "type");
  const statusParam = param(search, "status");
  const type = (ITEM_TYPES as readonly string[]).includes(typeParam) ? (typeParam as ItemType) : undefined;
  const status: ActiveFilter = statusParam === "inactive" || statusParam === "all" ? statusParam : "active";

  const [result, rates] = await Promise.all([
    repo.items.list({ q: q || undefined, type, status, page: pageParam(search), pageSize: PAGE_SIZE }),
    repo.taxes.listRates(),
  ]);
  const rateById = new Map(rates.map((r) => [r.id, r]));
  const canEdit = hasPermission(ctx.role, "items.update");

  const rows: ItemRow[] = result.rows.map((item) => {
    const rate = item.tax_rate_id ? rateById.get(item.tax_rate_id) : undefined;
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      description: item.description,
      item_type: item.item_type,
      unit: item.unit,
      unit_price: item.unit_price,
      currency: item.currency,
      taxLabel: rate ? `${rate.name} (${formatPercent(rate.rate)})` : "Company default",
      is_active: item.is_active,
      canEdit,
    };
  });

  const canCreate = hasPermission(ctx.role, "items.create");

  return (
    <>
      <PageHeader
        title="Products & services"
        description="Your catalog. Prices are excluding tax (HT); tax is applied on each document."
        actions={
          canCreate && (
            <>
              <SeedCatalogButton />
              <Link href="/sales/items/new" className={buttonVariants({ size: "sm" })}>
                <Plus className="size-4" aria-hidden /> New item
              </Link>
            </>
          )
        }
      />

      <FilterBar resetHref="/sales/items">
        <FilterInput name="q" label="Search" value={q} placeholder="Name, code, description" className="min-w-64 flex-1 space-y-1" />
        <FilterSelect
          name="type"
          label="Type"
          value={type ?? ""}
          options={ITEM_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
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

      <ItemsTable rows={rows} />
      <Pagination
        basePath="/sales/items"
        params={activeParams(search, ["q", "type", "status"])}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
