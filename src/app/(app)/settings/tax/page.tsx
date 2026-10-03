import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { TaxManager } from "./tax-manager";
import { WithholdingManager } from "./withholding-manager";

export const metadata: Metadata = { title: "Tax settings" };

export default async function TaxSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const [rates, withholdings, settings] = await Promise.all([
    repo.taxes.listRates(),
    repo.taxes.listWithholdings(),
    repo.organization.getSettings(),
  ]);

  return (
    <>
      <PageHeader title="Tax" description="VAT rates available on document lines and withholding types applied to invoices." />

      <TaxManager
        canEdit={hasPermission(ctx.role, "settings.tax.manage")}
        vatRegistered={settings?.vat_registered ?? true}
        rates={[...rates]
          .sort((a, b) => b.rate - a.rate)
          .map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            rate: r.rate,
            category: r.category,
            is_default: r.is_default,
            is_active: r.is_active,
          }))}
      />

      <WithholdingManager
        canEdit={hasPermission(ctx.role, "settings.tax.manage")}
        types={withholdings.map((w) => ({ id: w.id, code: w.code, name: w.name, rate: w.rate, base: w.base, is_active: w.is_active }))}
      />
    </>
  );
}
