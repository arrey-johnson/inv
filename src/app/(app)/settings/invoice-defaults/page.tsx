import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { InvoiceDefaultsForm } from "./invoice-defaults-form";

export const metadata: Metadata = { title: "Invoice defaults" };

export default async function InvoiceDefaultsSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const s = await repo.organization.getSettings();
  const canEdit = hasPermission(ctx.role, "settings.invoice_defaults.manage");

  return (
    <>
      <PageHeader title="Invoice defaults" description="Defaults applied to new documents. Each document can still override them." />
      {!s ? (
        <Alert variant="destructive">
          <AlertDescription>Settings are missing. Check the database migrations and seed data.</AlertDescription>
        </Alert>
      ) : (
        <InvoiceDefaultsForm
          canEdit={canEdit}
          defaultValues={{
            default_currency: s.default_currency,
            default_payment_terms_days: String(s.default_payment_terms_days),
            proforma_validity_days: String(s.proforma_validity_days),
            show_amount_in_words: s.show_amount_in_words,
            default_invoice_notes: s.default_invoice_notes ?? "",
            default_invoice_terms: s.default_invoice_terms ?? "",
            default_proforma_notes: s.default_proforma_notes ?? "",
            default_proforma_terms: s.default_proforma_terms ?? "",
          }}
        />
      )}
    </>
  );
}
