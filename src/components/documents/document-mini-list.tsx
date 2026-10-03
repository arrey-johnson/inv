import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DocumentListRow } from "@/lib/data/types";
import { DOCUMENT_ROUTES, DOCUMENT_TYPE_LABELS, effectiveStatus, isSalesDocumentType } from "@/lib/documents/status";
import { formatMoney } from "@/lib/finance/format";
import { formatDate } from "@/lib/utils";
import { DocumentStatusBadge } from "./document-status-badge";

/** Compact read-only list (customer detail, dashboards). */
export function DocumentMiniList({ rows, today }: { rows: ReadonlyArray<DocumentListRow>; today: string }) {
  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">No documents yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Number</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total TTC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              {isSalesDocumentType(d.document_type) ? (
                <Link href={`${DOCUMENT_ROUTES[d.document_type]}/${d.id}`} className="font-medium hover:underline">
                  {d.number ?? "Draft"}
                </Link>
              ) : (
                (d.number ?? "Draft")
              )}
            </TableCell>
            <TableCell>{isSalesDocumentType(d.document_type) ? DOCUMENT_TYPE_LABELS[d.document_type] : d.document_type}</TableCell>
            <TableCell>{formatDate(d.issue_date)}</TableCell>
            <TableCell>
              <DocumentStatusBadge status={effectiveStatus(d, today)} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(d.total_ttc, d.currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
