import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const org = await repo.organization.get();
  const canEdit = hasPermission(ctx.role, "settings.company.manage");

  return (
    <>
      <PageHeader title="Company" description="Legal identity and contact details printed on every document." />
      {!org ? (
        <Alert variant="destructive">
          <AlertDescription>Could not load the organization. Check the database migrations and seed data.</AlertDescription>
        </Alert>
      ) : (
        <>
          {!canEdit && (
            <Alert>
              <AlertDescription>You have read-only access. Ask an administrator to change company details.</AlertDescription>
            </Alert>
          )}
          <CompanyForm
            canEdit={canEdit}
            defaultValues={{
              legal_name: org.legal_name,
              trade_name: org.trade_name ?? "",
              niu: org.niu ?? "",
              rccm: org.rccm ?? "",
              address_line1: org.address_line1 ?? "",
              address_line2: org.address_line2 ?? "",
              city: org.city ?? "",
              region: org.region ?? "",
              country: org.country,
              phone: org.phone ?? "",
              email: org.email ?? "",
              website: org.website ?? "",
            }}
          />
        </>
      )}
    </>
  );
}
