import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Pencil } from "lucide-react";
import { CustomerActiveButton } from "@/components/customers/customer-active-button";
import { CustomerTypeBadge } from "@/components/customers/customer-type-badge";
import { DocumentMiniList } from "@/components/documents/document-mini-list";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/rbac";
import { customerNiuWarning } from "@/lib/customers/niu";
import { summarizeCustomerDocuments } from "@/lib/customers/summary";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { addDaysISO, todayISO } from "@/lib/utils/date-math";

export const metadata: Metadata = { title: "Customer" };

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value?.trim() ? value : <span className="text-muted-foreground">-</span>}</dd>
    </div>
  );
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, repo } = await requirePageRepo("customers.view");
  const customer = await repo.customers.get(id);
  if (!customer) notFound();

  const today = todayISO();
  const docs = await repo.documents.list({ customerId: id, today, pageSize: 200 });
  const summary = summarizeCustomerDocuments(docs.rows);
  const warning = customerNiuWarning(customer);
  const canUpdate = hasPermission(ctx.role, "customers.update");
  const currency = customer.default_currency;

  const address = [customer.address_line1, customer.address_line2, customer.city, customer.region, customer.country]
    .filter((p): p is string => Boolean(p?.trim()))
    .join(", ");

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.code ? `Customer ${customer.code}` : undefined}
        actions={
          <>
            {hasPermission(ctx.role, "proformas.create") && customer.is_active && (
              <Link href={`/sales/proformas/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                New proforma
              </Link>
            )}
            {hasPermission(ctx.role, "invoices.create") && customer.is_active && (
              <Link href={`/sales/invoices/new?customer=${customer.id}`} className={buttonVariants({ size: "sm" })}>
                New invoice
              </Link>
            )}
            {canUpdate && (
              <>
                <Link href={`/sales/customers/${customer.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Pencil className="size-4" aria-hidden /> Edit
                </Link>
                <CustomerActiveButton customerId={customer.id} isActive={customer.is_active} />
              </>
            )}
          </>
        }
      />

      {warning && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total invoiced (TTC)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(summary.invoiced, currency)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Paid / settled</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(summary.settled, currency)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(summary.outstanding, currency)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer statement</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" action={`/api/customers/${customer.id}/statement/pdf`} target="_blank" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="st-from" className="text-xs text-muted-foreground">From</label>
              <input id="st-from" name="from" type="date" defaultValue={addDaysISO(today, -90)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="st-to" className="text-xs text-muted-foreground">To</label>
              <input id="st-to" name="to" type="date" defaultValue={today} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
            </div>
            <input type="hidden" name="currency" value={currency} />
            <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Download statement (PDF)
            </button>
            <Link href={`/reports/customer-statement?customer=${customer.id}`} className="text-sm text-primary hover:underline">
              View as a report / export
            </Link>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Opening balance, invoices, credit notes and payments with a running balance, on the company letterhead.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Profile</CardTitle>
            <div className="flex gap-1.5">
              <CustomerTypeBadge type={customer.customer_type} />
              {!customer.is_active && <Badge variant="outline">Inactive</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Detail label="NIU" value={customer.niu} />
              <Detail label="RCCM" value={customer.rccm} />
              <Detail label="Contact" value={customer.contact_name} />
              <Detail label="Email" value={customer.email} />
              <Detail label="Phone" value={customer.phone} />
              <Detail label="Billing address" value={address} />
              <Detail label="Default currency" value={customer.default_currency} />
              <Detail
                label="Payment terms"
                value={customer.payment_terms_days === null ? null : `${customer.payment_terms_days} days`}
              />
              <Detail label="Notes" value={customer.notes} />
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Documents ({summary.invoiceCount} invoices, {summary.proformaCount} proformas)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentMiniList rows={docs.rows} today={today} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
