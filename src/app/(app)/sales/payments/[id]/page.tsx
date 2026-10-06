import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Paperclip } from "lucide-react";
import { ActivityTimeline } from "@/components/documents/document-panels";
import { documentStatusLabel } from "@/components/documents/document-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PaymentMethodLabel } from "@/components/payments/payment-method-label";
import { VoidPaymentButton } from "@/components/payments/void-payment-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { cn, formatDate } from "@/lib/utils";
import { z } from "zod";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { ctx, repo } = await requirePageRepo("payments.view");
  const detail = await repo.payments.get(id);
  if (!detail) notFound();

  const { payment, customer, allocations } = detail;
  const [attachments, audit] = await Promise.all([
    repo.attachments.listFor("payment", id),
    repo.audit.list({ entityIds: [id], limit: 50 }),
  ]);
  const voided = payment.voided_at !== null;

  return (
    <>
      <Link href="/sales/payments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Payments
      </Link>
      <PageHeader
        title={`Payment of ${formatMoney(payment.amount, payment.currency)}`}
        description={`${customer?.name ?? "Customer"} - ${formatDate(payment.payment_date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/payments/${id}/pdf?download=1`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download className="size-4" aria-hidden /> Download receipt
            </a>
            {!voided && hasPermission(ctx.role, "payments.void") && <VoidPaymentButton paymentId={id} />}
          </div>
        }
      />

      {voided && (
        <div role="status" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <strong>Cancelled</strong> on {formatDate(payment.voided_at!.slice(0, 10))}. Reason: {payment.void_reason}
        </div>
      )}
      {payment.is_adjustment && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          <strong>Administrator adjustment</strong> - a settlement outside the system, not a cash receipt. Reason: {payment.adjustment_reason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Method</p>
              <PaymentMethodLabel method={payment.method} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Reference</p>
              <p>{payment.reference ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              {customer ? (
                <Link href={`/sales/customers/${customer.id}`} className="text-primary hover:underline">
                  {customer.name}
                </Link>
              ) : (
                "-"
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Recorded</p>
              <p>{payment.created_at.slice(0, 16).replace("T", " ")}</p>
            </div>
            {payment.notes && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="whitespace-pre-line">{payment.notes}</p>
              </div>
            )}
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Proof of payment</p>
              {attachments.length === 0 ? (
                <p className="text-muted-foreground">None attached</p>
              ) : (
                attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/payments/${id}/proof?attachment=${a.id}`}
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Paperclip className="size-4" aria-hidden /> {a.file_name}
                  </a>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applied to</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status now</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead className="text-right">Balance now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map(({ allocation, document }) => (
                  <TableRow key={allocation.id}>
                    <TableCell>
                      {document ? (
                        <Link
                          href={`${document.document_type === "advance" ? "/sales/advances" : "/sales/invoices"}/${document.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {document.number}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{document ? documentStatusLabel(document.status) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(allocation.amount, payment.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{document ? formatMoney(document.balance_due, document.currency) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline entries={audit} />
        </CardContent>
      </Card>
    </>
  );
}
