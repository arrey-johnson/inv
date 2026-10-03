import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { FilterBar, FilterCheckbox, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { Pagination } from "@/components/data-table/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { PAYMENT_METHOD_LABELS, PaymentMethodLabel } from "@/components/payments/payment-method-label";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { isValidISODate } from "@/lib/utils/date-math";
import { formatDate } from "@/lib/utils";
import { activeParams, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/database";

export const metadata: Metadata = { title: "Payments" };

const FILTER_KEYS = ["q", "customer", "method", "from", "to", "voided"] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("payments.view");

  const q = param(search, "q");
  const customerId = param(search, "customer");
  const methodParam = param(search, "method");
  const method = (PAYMENT_METHODS as readonly string[]).includes(methodParam) ? (methodParam as PaymentMethod) : undefined;
  const from = isValidISODate(param(search, "from")) ? param(search, "from") : undefined;
  const to = isValidISODate(param(search, "to")) ? param(search, "to") : undefined;
  const includeVoided = param(search, "voided") === "1";

  const [result, customers] = await Promise.all([
    repo.payments.list({
      q: q || undefined,
      customerId: customerId || undefined,
      method,
      dateFrom: from,
      dateTo: to,
      includeVoided,
      page: pageParam(search),
      pageSize: 20,
    }),
    repo.customers.listActive(500),
  ]);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment received, with the invoices it settled. Balances and statuses update automatically."
        actions={
          hasPermission(ctx.role, "payments.create") && (
            <Link href="/sales/payments/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" aria-hidden /> Record payment
            </Link>
          )
        }
      />

      <FilterBar resetHref="/sales/payments">
        <FilterInput name="q" label="Search" value={q} placeholder="Reference, customer or invoice" className="min-w-48 flex-1 space-y-1" />
        <FilterSelect
          name="customer"
          label="Customer"
          value={customerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          allLabel="All customers"
        />
        <FilterSelect
          name="method"
          label="Method"
          value={method ?? ""}
          options={PAYMENT_METHODS.filter((m) => m !== "mobile_money").map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
          allLabel="All methods"
        />
        <FilterInput name="from" label="From" type="date" value={from ?? ""} />
        <FilterInput name="to" label="To" type="date" value={to ?? ""} />
        <FilterCheckbox name="voided" label="Include cancelled" checked={includeVoided} />
      </FilterBar>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Applied to</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No payment matches these filters.
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((p) => (
              <TableRow key={p.id} className={p.voided_at ? "text-muted-foreground line-through" : undefined}>
                <TableCell>
                  <Link href={`/sales/payments/${p.id}`} className="font-medium hover:underline">
                    {formatDate(p.payment_date)}
                  </Link>
                  {p.is_adjustment && <span className="ml-2 text-xs text-warning no-underline">Adjustment</span>}
                </TableCell>
                <TableCell>{p.customer_name}</TableCell>
                <TableCell>
                  <PaymentMethodLabel method={p.method} />
                </TableCell>
                <TableCell>{p.reference ?? "-"}</TableCell>
                <TableCell>{p.allocations.map((a) => a.document_number ?? "invoice").join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        basePath="/sales/payments"
        params={activeParams(search, FILTER_KEYS)}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
