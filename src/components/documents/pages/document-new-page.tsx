import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageRepo } from "@/lib/data/page";
import { newBuilderState } from "@/lib/documents/builder-model";
import { DOCUMENT_PERMISSIONS, DOCUMENT_TYPE_LABELS, getDocumentActions, type BuilderDocumentType } from "@/lib/documents/status";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { DocumentBuilder } from "../builder/document-builder";
import { loadBuilderData } from "./builder-data";

export async function DocumentNewPage({ type, searchParams }: { type: BuilderDocumentType; searchParams: RawSearchParams }) {
  const { ctx, repo } = await requirePageRepo(DOCUMENT_PERMISSIONS[type].create);
  const data = await loadBuilderData(repo);
  const label = DOCUMENT_TYPE_LABELS[type];

  if (!data) {
    return (
      <>
        <PageHeader title={`New ${label.toLowerCase()}`} />
        <Alert variant="destructive">
          <AlertDescription>Organization settings are missing. Check the database migrations and seed data.</AlertDescription>
        </Alert>
      </>
    );
  }

  // `?customer=` comes from the customer page and from "New customer" on the builder.
  const requested = param(searchParams, "customer");
  const preselected = data.customers.find((c) => c.id === requested) ?? null;
  const { settings, defaults } = data;

  const initial = newBuilderState({
    documentType: type,
    today: defaults.today,
    currency: preselected?.default_currency ?? settings.default_currency,
    paymentTermsDays: preselected?.payment_terms_days ?? defaults.paymentTermsDays,
    validityDays: defaults.validityDays,
    notes: type !== "proforma" ? settings.default_invoice_notes : settings.default_proforma_notes,
    terms: type !== "proforma" ? settings.default_invoice_terms : settings.default_proforma_terms,
    customerId: preselected?.id,
  });

  const actions = getDocumentActions(
    { document_type: type, status: "draft", approval_status: "none" },
    ctx.role,
    { requireApproval: settings.require_approval },
  );

  return (
    <>
      <PageHeader
        title={`New ${label.toLowerCase()}`}
        description="Save as a draft to keep editing later, or Issue when ready. The official number is assigned only on issue."
      />
      <DocumentBuilder
        documentType={type}
        documentId={null}
        initial={initial}
        approval={null}
        customers={data.customers}
        catalog={data.catalog}
        taxRates={data.taxRates}
        withholdingTypes={data.withholdingTypes}
        vatEnabled={data.vatEnabled}
        defaults={defaults}
        // New docs have no delete/duplicate yet; Issue still works (saves the draft first).
        actions={{ ...actions, deleteDraft: false, duplicate: false, convert: false }}
        canSave
      />
    </>
  );
}
