"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { customerNiuWarning } from "@/lib/customers/niu";
import type { Customer } from "@/types/database";
import { CustomerTypeBadge } from "./customer-type-badge";

export type CustomerRow = Pick<
  Customer,
  "id" | "name" | "code" | "customer_type" | "niu" | "rccm" | "email" | "phone" | "city" | "is_active"
>;

const columns: DataTableColumn<CustomerRow>[] = [
  {
    id: "name",
    header: "Customer",
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <Link href={`/sales/customers/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
        {row.original.code && <p className="text-xs text-muted-foreground">{row.original.code}</p>}
      </div>
    ),
  },
  { id: "type", header: "Type", cell: ({ row }) => <CustomerTypeBadge type={row.original.customer_type} /> },
  {
    id: "niu",
    header: "NIU",
    cell: ({ row }) =>
      row.original.niu ? (
        <span className="font-mono text-xs">{row.original.niu}</span>
      ) : customerNiuWarning(row.original) ? (
        <span className="inline-flex items-center gap-1 text-xs text-warning" title={customerNiuWarning(row.original) ?? undefined}>
          <AlertTriangle className="size-3.5" aria-hidden /> Missing
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    id: "rccm",
    header: "RCCM",
    cell: ({ row }) =>
      row.original.rccm ? <span className="font-mono text-xs">{row.original.rccm}</span> : <span className="text-muted-foreground">-</span>,
  },
  {
    id: "contact",
    header: "Contact",
    cell: ({ row }) => (
      <div className="space-y-0.5 text-sm">
        <p>{row.original.email ?? <span className="text-muted-foreground">-</span>}</p>
        {row.original.phone && <p className="text-xs text-muted-foreground">{row.original.phone}</p>}
      </div>
    ),
  },
  { id: "city", header: "City", cell: ({ row }) => row.original.city ?? "-" },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) =>
      row.original.is_active ? (
        <Badge variant="outline" className="border-transparent bg-success-soft text-success">
          Active
        </Badge>
      ) : (
        <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
          Inactive
        </Badge>
      ),
  },
];

export function CustomersTable({ rows }: { rows: CustomerRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      empty="No customers match. Create your first customer to start invoicing."
    />
  );
}
