"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table/data-table";
import { formatMoney } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";
import { formatDate } from "@/lib/utils/dates";
import type { DocumentStatus } from "@/types/database";
import { DocumentStatusBadge } from "./document-status-badge";

export interface DocumentRowView {
  id: string;
  href: string;
  number: string | null;
  customerName: string;
  issueDate: string;
  /** Due date (invoice) or validity (proforma). */
  secondaryDate: string | null;
  status: DocumentStatus;
  totalTtc: number;
  balanceDue: number;
  currency: CurrencyCode;
}

function buildColumns(kind: "receivable" | "proforma" | "credit_note"): DataTableColumn<DocumentRowView>[] {
  const columns: DataTableColumn<DocumentRowView>[] = [
    {
      id: "number",
      header: "Number",
      cell: ({ row }) => (
        <Link href={row.original.href} className="font-medium hover:underline">
          {row.original.number ?? <span className="text-muted-foreground italic">Draft</span>}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", cell: ({ row }) => row.original.customerName },
    { id: "issued", header: "Date", cell: ({ row }) => formatDate(row.original.issueDate) },
    {
      id: "secondary",
      header: kind === "receivable" ? "Due" : kind === "credit_note" ? "" : "Valid until",
      cell: ({ row }) => (row.original.secondaryDate ? formatDate(row.original.secondaryDate) : "-"),
    },
    { id: "status", header: "Status", cell: ({ row }) => <DocumentStatusBadge status={row.original.status} /> },
    {
      id: "total",
      header: () => <span className="block text-right">Total TTC</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">{formatMoney(row.original.totalTtc, row.original.currency)}</span>
      ),
    },
  ];
  if (kind === "receivable") {
    columns.push({
      id: "balance",
      header: () => <span className="block text-right">Balance due</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {row.original.status === "draft" ? "-" : formatMoney(row.original.balanceDue, row.original.currency)}
        </span>
      ),
    });
  }
  columns.push({
    id: "pdf",
    header: () => <span className="sr-only">PDF</span>,
    cell: ({ row }) => (
      <a
        href={`/api/documents/${row.original.id}/pdf?download=1`}
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
        aria-label={`Download PDF ${row.original.number ?? "draft"}`}
      >
        <Download className="size-4" aria-hidden />
      </a>
    ),
  });
  return columns;
}

const RECEIVABLE_COLUMNS = buildColumns("receivable");
const PROFORMA_COLUMNS = buildColumns("proforma");
const CREDIT_NOTE_COLUMNS = buildColumns("credit_note");

export function DocumentsTable({ kind, rows }: { kind: "invoice" | "advance" | "proforma" | "credit_note"; rows: DocumentRowView[] }) {
  return (
    <DataTable
      columns={kind === "invoice" || kind === "advance" ? RECEIVABLE_COLUMNS : kind === "credit_note" ? CREDIT_NOTE_COLUMNS : PROFORMA_COLUMNS}
      data={rows}
      getRowId={(r) => r.id}
      empty="No documents match these filters."
    />
  );
}
