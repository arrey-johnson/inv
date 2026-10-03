import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { FilterBar, FilterSelect } from "@/components/data-table/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PaymentForm } from "@/components/payments/payment-form";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { isPayableDocument } from "@/lib/payments/settlement";
import { refreshOverdue } from "@/lib/payments/payment-service";
import { todayISO } from "@/lib/utils/date-math";
import { param, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { ctx, repo } = await requirePageRepo("payments.create");
  const today = todayISO();
  // Overdue status refresh must not delay the payment form.
  after(() => {
    void refreshOverdue(repo, today);
  });

  const customerId = param(search, "customer");
  const invoiceId = param(search, "invoice");
  const customers = await repo.customers.listActive(500);
  const customer = customerId ? (customers.find((c) => c.id === customerId) ?? (await repo.customers.get(customerId))) : null;

  const open = customer
    ? (await repo.documents.listAll({ customerId: customer.id, types: ["invoice", "advance"], today }))
        .filter((d) => isPayableDocument(d))
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    : [];

  return (
    <>
      <Link href="/sales/payments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Payments
      </Link>
      <PageHeader
        title="Record a payment"
        description="Full, partial or one payment covering several invoices. The amount can never exceed what is owed."
      />

      {!customer ? (
        <FilterBar resetHref="/sales/payments">
          <FilterSelect
            name="customer"
            label="Customer"
            value=""
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            allLabel="Choose a customer..."
          />
        </FilterBar>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Customer: <strong className="text-foreground">{customer.name}</strong> -{" "}
            <Link href="/sales/payments/new" className="text-primary hover:underline">
              change
            </Link>
          </p>
          {open.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              {customer.name} has no unpaid issued invoice. Issue an invoice first; a payment is always applied to an invoice.
            </p>
          ) : (
            <PaymentForm
              customerId={customer.id}
              customerName={customer.name}
              today={today}
              canAdjust={hasPermission(ctx.role, "payments.adjust")}
              preselectInvoiceId={invoiceId || null}
              invoices={open.map((d) => ({
                id: d.id,
                number: d.number ?? "invoice",
                type: d.document_type,
                dueDate: d.due_date,
                currency: d.currency,
                balanceDue: d.balance_due,
                total: d.net_payable,
                overdue: d.due_date !== null && d.due_date < today,
              }))}
            />
          )}
        </>
      )}
    </>
  );
}
