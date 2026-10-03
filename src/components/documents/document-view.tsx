import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DocumentBundle } from "@/lib/data/types";
import { DOCUMENT_ROUTES, DOCUMENT_TYPE_LABELS, effectiveStatus, isReceivableType, isSalesDocumentType } from "@/lib/documents/status";
import { formatMoney, formatNumber, formatQuantity } from "@/lib/finance/format";
import { D, sumDecimals } from "@/lib/finance/money";
import { formatDate } from "@/lib/utils";
import type { DocumentLink } from "@/types/database";
import { TotalsPanel, type TotalsView } from "./builder/totals-panel";
import { DocumentStatusBadge } from "./document-status-badge";

export interface LinkedDocument {
  link: DocumentLink;
  direction: "from" | "to";
  number: string | null;
  href: string;
  label: string;
}

function snapshotText(value: unknown, key: string): string | null {
  if (value && typeof value === "object" && key in value) {
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === "string" && raw.trim() ? raw : null;
  }
  return null;
}

/** Totals grouped by VAT rate, from the stored lines (Decimal sums). */
function totalsFromBundle(bundle: DocumentBundle): TotalsView {
  const d = bundle.document;
  const byRate = new Map<number, string[]>();
  for (const item of bundle.items) {
    const list = byRate.get(item.tax_rate) ?? [];
    list.push(String(item.tax_amount));
    byRate.set(item.tax_rate, list);
  }
  return {
    subtotal: d.subtotal,
    lineDiscountTotal: d.line_discount_total,
    globalDiscountAmount: d.global_discount_amount,
    netHT: d.net_ht,
    taxTotal: d.tax_total,
    totalTTC: d.total_ttc,
    taxBreakdown: [...byRate.entries()].map(([rate, amounts]) => ({
      rate,
      taxAmount: sumDecimals(amounts).toNumber(),
    })),
    withholdings: bundle.withholdings.map((w) => ({ code: w.code, rate: w.rate, amount: w.amount })),
    withholdingTotal: d.withholding_total,
    netPayable: d.net_payable,
  };
}

/** Read-only presentation of a saved document (issued, void, or a draft the viewer cannot edit). */
export function DocumentView({
  bundle,
  today,
  linked,
}: {
  bundle: DocumentBundle;
  today: string;
  linked: LinkedDocument[];
}) {
  const { document: doc, items } = bundle;
  const customerName = snapshotText(doc.customer_snapshot, "name") ?? bundle.customer?.name ?? "-";
  const customerNiu = snapshotText(doc.customer_snapshot, "niu") ?? bundle.customer?.niu ?? null;
  const totals = totalsFromBundle(bundle);
  const status = effectiveStatus(doc, today);
  const typeLabel = isSalesDocumentType(doc.document_type) ? DOCUMENT_TYPE_LABELS[doc.document_type] : doc.document_type;
  const anyTax = items.some((i) => i.tax_rate > 0) || new D(doc.tax_total).gt(0);

  return (
    <div className="space-y-6">
      {doc.status === "void" && (
        <div role="status" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <strong>Cancelled</strong>
          {doc.voided_at ? ` on ${formatDate(doc.voided_at.slice(0, 10))}` : ""}. The number {doc.number} is kept in the register.
          {doc.void_reason ? ` Reason: ${doc.void_reason}` : ""}
        </div>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {typeLabel} {doc.number ?? "(draft)"}
          </CardTitle>
          <DocumentStatusBadge status={status} />
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p className="font-medium">{customerName}</p>
            {customerNiu && <p className="text-xs text-muted-foreground">NIU {customerNiu}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Issue date</p>
            <p>{formatDate(doc.issue_date)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{doc.document_type === "proforma" ? "Valid until" : "Due date"}</p>
            <p>{doc.document_type === "proforma" ? (doc.valid_until ? formatDate(doc.valid_until) : "-") : doc.due_date ? formatDate(doc.due_date) : "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Reference</p>
            <p>{doc.reference ?? "-"}</p>
          </div>
          {doc.subject && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-muted-foreground">Subject</p>
              <p>{doc.subject}</p>
            </div>
          )}
          {linked.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-muted-foreground">Related documents</p>
              <ul className="space-y-0.5">
                {linked.map((l) => (
                  <li key={l.link.id}>
                    {l.label}{" "}
                    <Link href={l.href} className="font-medium text-primary hover:underline">
                      {l.number ?? "draft"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price HT</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Amount HT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...items]
                .sort((a, b) => a.position - b.position)
                .map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.description}</p>
                      {item.details && <p className="whitespace-pre-line text-xs text-muted-foreground">{item.details}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(item.quantity)} {item.unit ?? ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.unit_price, doc.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.discount_amount > 0 ? formatNumber(item.discount_amount, doc.currency) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.taxable_amount, doc.currency)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes and terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="whitespace-pre-line">{doc.notes ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Terms</p>
              <p className="whitespace-pre-line">{doc.terms ?? "-"}</p>
            </div>
            {doc.internal_notes && (
              <div>
                <p className="text-xs text-muted-foreground">Internal notes</p>
                <p className="whitespace-pre-line">{doc.internal_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TotalsPanel totals={totals} currency={doc.currency} vatEnabled={anyTax} />
            {isReceivableType(doc.document_type) && doc.status !== "draft" && doc.status !== "void" && (
              <p className="text-sm text-muted-foreground">
                Balance due: <strong className="tabular-nums text-foreground">{formatMoney(doc.balance_due, doc.currency)}</strong>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function documentRouteFor(type: string, id: string): string {
  return isSalesDocumentType(type as "invoice") ? `${DOCUMENT_ROUTES[type as "invoice"]}/${id}` : `/sales/${id}`;
}
