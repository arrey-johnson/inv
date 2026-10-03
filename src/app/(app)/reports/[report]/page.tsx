import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { refreshOverdue } from "@/lib/payments/payment-service";
import { RANGE_PRESETS, RANGE_PRESET_LABELS, isRangePreset, resolveDateRange } from "@/lib/reports/date-range";
import { displayCell } from "@/lib/reports/export";
import { runReport } from "@/lib/reports/run-report";
import { REPORT_META, isReportId } from "@/lib/reports/types";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/utils/date-math";
import { param, type RawSearchParams } from "@/lib/utils/search-params";

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }): Promise<Metadata> {
  const { report } = await params;
  return { title: isReportId(report) ? REPORT_META[report].title : "Report" };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { report: id } = await params;
  if (!isReportId(id)) notFound();
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("reports.view");
  const today = todayISO();
  await refreshOverdue(repo, today);

  const meta = REPORT_META[id];
  const presetParam = param(search, "range");
  const preset = isRangePreset(presetParam) ? presetParam : "year";
  const range = resolveDateRange(preset, today, { from: param(search, "from"), to: param(search, "to") });
  const currencyParam = param(search, "currency");
  const currency = (CURRENCY_CODES as readonly string[]).includes(currencyParam) ? (currencyParam as (typeof CURRENCY_CODES)[number]) : undefined;
  const customerId = param(search, "customer") || null;

  const customers = id === "customer-statement" ? await repo.customers.listActive(1000) : [];
  const report = await runReport(repo, { id, range, currency, customerId, today });
  const fmt = (n: number) => formatMoney(n, report.currency);

  const exportQuery = new URLSearchParams({ range: preset, from: range.from, to: range.to });
  if (currency) exportQuery.set("currency", currency);
  if (customerId) exportQuery.set("customer", customerId);
  const canExport = hasPermission(ctx.role, "reports.export");

  return (
    <>
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Reports
      </Link>
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          canExport && (
            <>
              <a href={`/api/reports/${id}/export?format=csv&${exportQuery}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <Download className="size-4" aria-hidden /> CSV
              </a>
              <a href={`/api/reports/${id}/export?format=xlsx&${exportQuery}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <FileSpreadsheet className="size-4" aria-hidden /> Excel
              </a>
            </>
          )
        }
      />

      <FilterBar resetHref={`/reports/${id}`}>
        {meta.usesPeriod && (
          <>
            <FilterSelect
              name="range"
              label="Period"
              value={preset}
              allValue="year"
              allLabel={RANGE_PRESET_LABELS.year}
              options={RANGE_PRESETS.filter((p) => p !== "year").map((p) => ({ value: p, label: RANGE_PRESET_LABELS[p] }))}
            />
            <FilterInput name="from" label="Custom from" type="date" value={preset === "custom" ? range.from : ""} />
            <FilterInput name="to" label="Custom to" type="date" value={preset === "custom" ? range.to : ""} />
          </>
        )}
        <FilterSelect
          name="currency"
          label="Currency"
          value={report.currency}
          allValue={report.currency}
          allLabel={report.currency}
          options={CURRENCY_CODES.filter((c) => c !== report.currency).map((c) => ({ value: c, label: c }))}
        />
        {id === "customer-statement" && (
          <FilterSelect
            name="customer"
            label="Customer"
            value={customerId ?? ""}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            allLabel="Choose a customer..."
          />
        )}
      </FilterBar>

      <p className="text-sm text-muted-foreground">
        {report.period ? `Period ${report.period.from} to ${report.period.to}` : "As of today"} - amounts in {report.currency}
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {report.columns.map((c) => (
                <TableHead key={c.key} className={c.type === "money" || c.type === "number" || c.type === "percent" ? "text-right" : undefined}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={report.columns.length} className="py-8 text-center text-muted-foreground">
                  Nothing to report for these filters.
                </TableCell>
              </TableRow>
            )}
            {report.rows.map((row, index) => (
              <TableRow key={index}>
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={c.type === "money" || c.type === "number" || c.type === "percent" ? "text-right tabular-nums" : undefined}>
                    {displayCell(row[c.key] ?? null, c, fmt)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {report.totals && report.rows.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                {report.columns.map((c, index) => (
                  <TableCell key={c.key} className={c.type === "money" || c.type === "number" ? "text-right tabular-nums" : undefined}>
                    {index === 0 && report.totals?.[c.key] == null ? "Total" : displayCell(report.totals?.[c.key] ?? null, c, fmt)}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {report.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </>
  );
}
