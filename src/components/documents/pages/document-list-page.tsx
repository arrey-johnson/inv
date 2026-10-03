import Link from "next/link";
import { after } from "next/server";
import { Plus } from "lucide-react";
import { FilterBar, FilterCheckbox, FilterInput, FilterSelect } from "@/components/data-table/filter-bar";
import { Pagination } from "@/components/data-table/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import {
  DOCUMENT_PERMISSIONS,
  DOCUMENT_ROUTES,
  DOCUMENT_TYPE_LABELS,
  effectiveStatus,
  isReceivableType,
  type SalesDocumentType,
} from "@/lib/documents/status";
import { refreshOverdue } from "@/lib/payments/payment-service";
import { cn } from "@/lib/utils";
import { isValidISODate, todayISO } from "@/lib/utils/date-math";
import { activeParams, amountParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import type { DocumentStatus } from "@/types/database";
import { documentStatusLabel } from "../document-status-badge";
import { DocumentsTable, type DocumentRowView } from "../documents-table";

const PAGE_SIZE = 20;
const FILTER_KEYS = ["q", "status", "customer", "from", "to", "min", "max", "overdue"] as const;

const STATUS_FILTERS: Record<SalesDocumentType, DocumentStatus[]> = {
  invoice: ["draft", "issued", "sent", "partially_paid", "overdue", "paid", "credited", "void"],
  proforma: ["draft", "issued", "sent", "accepted", "rejected", "expired", "converted", "void"],
  advance: ["draft", "issued", "sent", "partially_paid", "overdue", "paid", "void"],
  credit_note: ["issued", "void"],
};

const TITLES: Record<SalesDocumentType, { title: string; description: string }> = {
  invoice: { title: "Invoices", description: "Official invoices. Numbers are assigned when a draft is issued." },
  proforma: {
    title: "Proformas",
    description: "Quotes sent before invoicing. Convert an accepted proforma into an invoice in one click.",
  },
  advance: {
    title: "Advance invoices",
    description: "Deposits invoiced before the work is done. Once paid, an advance is deducted from the final invoice without charging its VAT twice.",
  },
  credit_note: {
    title: "Credit notes",
    description: "Reduce or cancel an issued invoice without editing or deleting it. Each credit note keeps its own number.",
  },
};

function dateParam(search: RawSearchParams, key: string): string | undefined {
  const value = param(search, key);
  return value && isValidISODate(value) ? value : undefined;
}

export async function DocumentListPage({ type, searchParams }: { type: SalesDocumentType; searchParams: RawSearchParams }) {
  const perms = DOCUMENT_PERMISSIONS[type];
  const { ctx, repo } = await requirePageRepo(perms.view);
  const today = todayISO();
  const receivable = isReceivableType(type);
  const overdueOnly = receivable && param(searchParams, "overdue") === "1";
  // Only wait for overdue sync when the list is filtered by overdue; otherwise schedule it.
  if (overdueOnly) {
    await refreshOverdue(repo, today);
  } else {
    after(() => {
      void refreshOverdue(repo, today);
    });
  }

  const q = param(searchParams, "q");
  const statusParam = param(searchParams, "status");
  const status = (STATUS_FILTERS[type] as string[]).includes(statusParam) ? (statusParam as DocumentStatus) : undefined;
  const customerId = param(searchParams, "customer");
  const from = dateParam(searchParams, "from");
  const to = dateParam(searchParams, "to");
  const minAmount = amountParam(searchParams, "min");
  const maxAmount = amountParam(searchParams, "max");

  const [result, customers] = await Promise.all([
    repo.documents.list({
      type,
      statuses: status ? [status] : undefined,
      customerId: customerId || undefined,
      dateFrom: from,
      dateTo: to,
      minAmount: minAmount ?? undefined,
      maxAmount: maxAmount ?? undefined,
      overdueOnly,
      q: q || undefined,
      today,
      page: pageParam(searchParams),
      pageSize: PAGE_SIZE,
    }),
    repo.customers.listActive(500),
  ]);

  const rows: DocumentRowView[] = result.rows.map((d) => ({
    id: d.id,
    href: `${DOCUMENT_ROUTES[type]}/${d.id}`,
    number: d.number,
    customerName: d.customer_name,
    issueDate: d.issue_date,
    secondaryDate: receivable ? d.due_date : d.valid_until,
    status: effectiveStatus(d, today),
    totalTtc: d.total_ttc,
    balanceDue: d.balance_due,
    currency: d.currency,
  }));

  const label = DOCUMENT_TYPE_LABELS[type];
  const tabs: Array<{ type: SalesDocumentType; title: string }> = [
    { type: "proforma", title: "Proformas" },
    { type: "advance", title: "Advances" },
    { type: "invoice", title: "Invoices" },
    { type: "credit_note", title: "Credit notes" },
  ];
  const newHref = type === "credit_note" ? "/sales/credit-notes/new" : `${DOCUMENT_ROUTES[type]}/new`;

  return (
    <>
      <PageHeader
        title={TITLES[type].title}
        description={TITLES[type].description}
        actions={
          hasPermission(ctx.role, perms.create) && (
            <Link href={newHref} className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" aria-hidden /> New {label.toLowerCase()}
            </Link>
          )
        }
      />

      <nav className="flex gap-1 border-b" aria-label="Document type">
        {tabs.map((tab) =>
          hasPermission(ctx.role, DOCUMENT_PERMISSIONS[tab.type].view) ? (
            <Link
              key={tab.type}
              href={DOCUMENT_ROUTES[tab.type]}
              aria-current={tab.type === type ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                tab.type === type ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.title}
            </Link>
          ) : null,
        )}
      </nav>

      <FilterBar resetHref={DOCUMENT_ROUTES[type]}>
        <FilterInput name="q" label="Search" value={q} placeholder="Number or reference" className="min-w-48 flex-1 space-y-1" />
        <FilterSelect
          name="customer"
          label="Customer"
          value={customerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          allLabel="All customers"
        />
        <FilterSelect
          name="status"
          label="Status"
          value={status ?? ""}
          options={STATUS_FILTERS[type].map((s) => ({ value: s, label: documentStatusLabel(s) }))}
          allLabel="All statuses"
        />
        <FilterInput name="from" label="From" type="date" value={from ?? ""} />
        <FilterInput name="to" label="To" type="date" value={to ?? ""} />
        <FilterInput name="min" label="Min total" value={param(searchParams, "min")} className="w-28 space-y-1" />
        <FilterInput name="max" label="Max total" value={param(searchParams, "max")} className="w-28 space-y-1" />
        {receivable && <FilterCheckbox name="overdue" label="Overdue only" checked={overdueOnly} />}
      </FilterBar>

      <DocumentsTable kind={type} rows={rows} />
      <Pagination
        basePath={DOCUMENT_ROUTES[type]}
        params={activeParams(searchParams, FILTER_KEYS)}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
