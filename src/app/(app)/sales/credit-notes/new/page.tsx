import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreditNoteForm } from "@/components/documents/credit-note-form";
import { FilterBar, FilterSelect } from "@/components/data-table/filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { loadCreditContext } from "@/lib/credit-notes/credit-note-service";
import { requirePageRepo } from "@/lib/data/page";
import { formatMoney } from "@/lib/finance/format";
import { todayISO } from "@/lib/utils/date-math";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { z } from "zod";

export const metadata: Metadata = { title: "New credit note" };

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = await searchParams;
  const { repo } = await requirePageRepo("credit_notes.create");
  const invoiceParam = param(search, "invoice");
  const invoiceId = z.string().uuid().safeParse(invoiceParam).success ? invoiceParam : null;

  const back = (
    <Link href="/sales/credit-notes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Credit notes
    </Link>
  );

  if (!invoiceId) {
    const invoices = (await repo.documents.listAll({ type: "invoice", today: todayISO() })).filter(
      (d) => d.status !== "draft" && d.status !== "void" && d.status !== "credited",
    );
    return (
      <>
        {back}
        <PageHeader title="New credit note" description="Choose the issued invoice to credit. The invoice itself is never edited or deleted." />
        <FilterBar resetHref="/sales/credit-notes">
          <FilterSelect
            name="invoice"
            label="Invoice"
            value=""
            options={invoices.map((d) => ({ value: d.id, label: `${d.number} - ${d.customer_name} - ${formatMoney(d.total_ttc, d.currency)}` }))}
            allLabel="Choose an invoice..."
          />
        </FilterBar>
      </>
    );
  }

  const [context, rates] = await Promise.all([loadCreditContext(repo, invoiceId), repo.taxes.listRates()]);
  const invoice = context.invoice.document;
  const blocked =
    invoice.document_type !== "invoice"
      ? "Only invoices can be credited."
      : invoice.status === "draft"
        ? "A draft invoice is edited or deleted, not credited."
        : invoice.status === "void"
          ? "This invoice is cancelled, so there is nothing to credit."
          : context.remainingTTC <= 0
            ? "This invoice has already been credited in full."
            : null;

  return (
    <>
      {back}
      <PageHeader title={`Credit note for ${invoice.number ?? "invoice"}`} description={`Customer: ${context.invoice.customer?.name ?? "-"}`} />
      {blocked ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{blocked}</p>
      ) : (
        <CreditNoteForm
          invoiceId={invoice.id}
          invoiceNumber={invoice.number ?? "invoice"}
          currency={invoice.currency}
          totalTtc={invoice.total_ttc}
          creditedTtc={context.creditedTTC}
          remainingTtc={context.remainingTTC}
          lines={context.lines.map((l) => ({
            itemId: l.item.id,
            description: l.item.description,
            quantity: l.item.quantity,
            credited: l.credited,
            remaining: l.remaining,
            unitPrice: l.item.unit_price,
            taxRate: l.item.tax_rate,
          }))}
          taxRates={rates.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name, rate: r.rate }))}
        />
      )}
    </>
  );
}
