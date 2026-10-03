import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { DefinitionRow } from "@/components/settings/definition-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { PaymentMethodsManager } from "./payment-methods-manager";

export const metadata: Metadata = { title: "Payment methods" };

export default async function PaymentMethodsSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const [settings, destinations] = await Promise.all([repo.organization.getSettings(), repo.paymentDestinations.list()]);

  const hasLegacy = Boolean(
    settings?.bank_name || settings?.bank_account_number || settings?.bank_iban || settings?.mobile_money_number,
  );

  return (
    <>
      <PageHeader
        title="Payment methods"
        description="Accepted methods and the bank / mobile money details printed on invoices."
      />

      <PaymentMethodsManager
        canEdit={hasPermission(ctx.role, "settings.payment_methods.manage")}
        enabledMethods={settings?.enabled_payment_methods ?? []}
        destinations={destinations.map((d) => ({
          id: d.id,
          kind: d.kind,
          label: d.label,
          provider: d.provider,
          account_name: d.account_name,
          account_number: d.account_number,
          iban: d.iban,
          swift: d.swift,
          is_default: d.is_default,
          is_active: d.is_active,
          show_on_documents: d.show_on_documents,
        }))}
      />

      {hasLegacy && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legacy bank details</CardTitle>
            <CardDescription>
              Older single-account fields. They are only printed when no destination above is active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DefinitionRow label="Bank name" value={settings?.bank_name} />
              <DefinitionRow label="Account name" value={settings?.bank_account_name} />
              <DefinitionRow label="Account number" value={settings?.bank_account_number} />
              <DefinitionRow label="IBAN" value={settings?.bank_iban} />
              <DefinitionRow label="SWIFT / BIC" value={settings?.bank_swift} />
              <DefinitionRow label="Mobile money" value={settings?.mobile_money_number} />
            </dl>
          </CardContent>
        </Card>
      )}
    </>
  );
}
