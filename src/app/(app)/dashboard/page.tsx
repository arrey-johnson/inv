import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FilePlus2, FileText, Hourglass, Landmark, ReceiptText, Wallet } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { SalesChart } from "@/components/reports/sales-chart";
import { StatCard } from "@/components/reports/stat-card";
import { documentStatusLabel } from "@/components/documents/document-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/rbac";
import { buildDashboard } from "@/lib/dashboard/build-dashboard";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { refreshOverdue } from "@/lib/payments/payment-service";
import { RANGE_PRESETS, RANGE_PRESET_LABELS, isRangePreset, resolveDateRange } from "@/lib/reports/date-range";
import { loadReportDataset } from "@/lib/reports/run-report";
import { todayISO } from "@/lib/utils/date-math";
import { formatDate } from "@/lib/utils";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import type { DocumentStatus } from "@/types/database";

export const metadata: Metadata = { title: "Dashboard" };

const TYPE_HREF: Record<string, string> = {
  invoice: "/sales/invoices",
  advance: "/sales/advances",
  credit_note: "/sales/credit-notes",
  proforma: "/sales/proformas",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("dashboard.view");
  const today = todayISO();
  await refreshOverdue(repo, today);

  const presetParam = param(search, "range");
  const preset = isRangePreset(presetParam) ? presetParam : "this_month";
  const range = resolveDateRange(preset, today, { from: param(search, "from"), to: param(search, "to") });

  let data: ReturnType<typeof buildDashboard> | null = null;
  try {
    const dataset = await loadReportDataset(repo, { id: "sales-summary", range, today });
    data = buildDashboard(dataset, range);
  } catch (error) {
    console.error("[dashboard] could not load figures", error);
  }
  const money = (n: number) => (data ? formatMoney(n, data.currency) : "-");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Figures for ${range.label.toLowerCase()} (${range.from} to ${range.to}). Outstanding and overdue are as of today.`}
        actions={
          hasPermission(ctx.role, "invoices.create") && (
            <Button asChild className="h-9">
              <Link href="/sales/invoices/new">
                <FilePlus2 className="size-4" /> New invoice
              </Link>
            </Button>
          )
        }
      />

      <FilterBar resetHref="/dashboard">
        <FilterSelect
          name="range"
          label="Period"
          value={preset}
          allValue="this_month"
          allLabel={RANGE_PRESET_LABELS.this_month}
          options={RANGE_PRESETS.filter((p) => p !== "this_month").map((p) => ({ value: p, label: RANGE_PRESET_LABELS[p] }))}
        />
        <FilterInput name="from" label="Custom from" type="date" value={preset === "custom" ? range.from : ""} />
        <FilterInput name="to" label="Custom to" type="date" value={preset === "custom" ? range.to : ""} />
      </FilterBar>

      {!data && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            Some figures could not be loaded. Check the database connection and migrations.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              title="Invoiced in period"
              value={money(data.invoiced.ttc)}
              hint={`${money(data.invoiced.ht)} excl. VAT - ${data.invoiced.count} document${data.invoiced.count === 1 ? "" : "s"}, net of credit notes`}
              icon={FileText}
            />
            <StatCard title="Paid in period" value={money(data.paid.amount)} hint={`${data.paid.count} payment${data.paid.count === 1 ? "" : "s"} received`} icon={Wallet} />
            <StatCard
              title="Outstanding"
              value={money(data.outstanding.amount)}
              hint={`${data.outstanding.count} open invoice${data.outstanding.count === 1 ? "" : "s"}`}
              icon={Landmark}
            />
            <StatCard
              title="Overdue"
              value={money(data.overdue.amount)}
              hint={`${data.overdue.count} invoice${data.overdue.count === 1 ? "" : "s"} past due`}
              icon={Hourglass}
              tone={data.overdue.count > 0 ? "danger" : "default"}
            />
            <StatCard
              title="VAT charged"
              value={money(data.vat.charged)}
              hint={`${money(data.vat.collectedOnPayments)} collected on payments (accounting aid)`}
              icon={ReceiptText}
            />
            <StatCard
              title="Proformas awaiting answer"
              value={String(data.proformasAwaiting.count)}
              hint={`${money(data.proformasAwaiting.total)} quoted`}
              icon={FileText}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly sales</CardTitle>
            </CardHeader>
            <CardContent>
              <SalesChart data={data.monthly} currency={data.currency} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent payments</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentPayments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payment yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Invoices</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentPayments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link href={`/sales/payments/${p.id}`} className="hover:underline">
                              {formatDate(p.date)}
                            </Link>
                          </TableCell>
                          <TableCell>{p.customer}</TableCell>
                          <TableCell className="text-muted-foreground">{p.invoices}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent documents</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoice issued yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Number</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentInvoices.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>
                            <Link href={`${TYPE_HREF[i.type] ?? "/sales/invoices"}/${i.id}`} className="font-medium hover:underline">
                              {i.number}
                            </Link>
                          </TableCell>
                          <TableCell>{i.customer}</TableCell>
                          <TableCell>{documentStatusLabel(i.status as DocumentStatus)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(i.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top customers in the period</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales in this period.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {data.topCustomers.map((c, index) => (
                    <li key={c.customerId} className="flex justify-between gap-4">
                      <span>
                        {index + 1}.{" "}
                        <Link href={`/sales/customers/${c.customerId}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </span>
                      <span className="tabular-nums">{money(c.invoiced)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
