"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";
import type { ItemType } from "@/types/database";

export interface ItemRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  item_type: ItemType;
  unit: string | null;
  unit_price: number;
  currency: CurrencyCode;
  taxLabel: string;
  is_active: boolean;
  canEdit: boolean;
}

const columns: DataTableColumn<ItemRow>[] = [
  { id: "sku", header: "Code", cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku ?? "-"}</span> },
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="space-y-0.5">
        {row.original.canEdit ? (
          <Link href={`/sales/items/${row.original.id}/edit`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ) : (
          <span className="font-medium">{row.original.name}</span>
        )}
        {row.original.description && <p className="line-clamp-1 text-xs text-muted-foreground">{row.original.description}</p>}
      </div>
    ),
  },
  { id: "type", header: "Type", cell: ({ row }) => <Badge variant="secondary" className="capitalize">{row.original.item_type}</Badge> },
  { id: "unit", header: "Unit", cell: ({ row }) => row.original.unit ?? "-" },
  {
    id: "price",
    header: () => <span className="block text-right">Price HT</span>,
    cell: ({ row }) => <span className="block text-right tabular-nums">{formatMoney(row.original.unit_price, row.original.currency)}</span>,
  },
  { id: "tax", header: "Tax", cell: ({ row }) => row.original.taxLabel },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) =>
      row.original.is_active ? (
        <Badge variant="outline" className="border-transparent bg-success-soft text-success">Active</Badge>
      ) : (
        <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">Inactive</Badge>
      ),
  },
];

export function ItemsTable({ rows }: { rows: ItemRow[] }) {
  return (
    <DataTable columns={columns} data={rows} getRowId={(r) => r.id} empty="No items yet. Create one or load the starter catalog." />
  );
}
