import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { advanceRemaining, listAvailableAdvances } from "@/lib/advances/advance-service";
import { hasPermission } from "@/lib/auth/rbac";
import { loadCreditContext } from "@/lib/credit-notes/credit-note-service";
import { requirePageRepo } from "@/lib/data/page";
import type { Repository } from "@/lib/data/types";
import { builderStateFromBundle } from "@/lib/documents/builder-model";
import { getLifecycleActions } from "@/lib/documents/lifecycle";
import { summarizeLink } from "@/lib/documents/link-service";
import {
  DOCUMENT_PERMISSIONS,
  DOCUMENT_ROUTES,
  DOCUMENT_TYPE_LABELS,
  getDocumentActions,
  isBuilderDocumentType,
  isReceivableType,
  isSalesDocumentType,
  type SalesDocumentType,
} from "@/lib/documents/status";
import { refreshOverdue } from "@/lib/payments/payment-service";
import { todayISO } from "@/lib/utils/date-math";
import type { RawSearchParams } from "@/lib/utils/search-params";
import { param } from "@/lib/utils/search-params";
import { DocumentBuilder } from "../builder/document-builder";
import { DocumentActionBar } from "../document-action-bar";
import { DocumentLifecycleBar, PublicLinkPanel } from "../document-lifecycle-bar";
import { ActivityTimeline, DocumentTabs, EmailLogList, PaymentsPanel } from "../document-panels";
import { DocumentView, documentRouteFor, type LinkedDocument } from "../document-view";
import { loadBuilderData } from "./builder-data";

async function loadLinked(repo: Repository, id: string): Promise<LinkedDocument[]> {
  const links = await repo.documents.linksFor(id);
  const out: LinkedDocument[] = [];
  for (const link of links) {
    const otherId = link.source_document_id === id ? link.target_document_id : link.source_document_id;
    const direction = link.source_document_id === id ? "to" : "from";
    const other = await repo.documents.get(otherId);
    if (!other) continue;
    const label =
      link.link_type === "converted_to"
        ? direction === "to"
          ? "Converted into"
          : "Converted from"
        : link.link_type === "duplicate_of"
          ? direction === "to"
            ? "Duplicated as"
            : "Duplicate of"
          : link.link_type === "credit_for"
            ? direction === "to"
              ? "Credit note for"
              : "Credited by"
            : link.link_type.replace(/_/g, " ");
    out.push({
      link,
      direction,
      number: other.document.number,
      href: documentRouteFor(other.document.document_type, otherId),
      label,
    });
  }
  return out;
}

async function numberAndHref(repo: Repository, id: string): Promise<{ number: string | null; href: string }> {
  const other = await repo.documents.get(id);
  return { number: other?.document.number ?? null, href: other ? documentRouteFor(other.document.document_type, id) : "#" };
}

const PLURAL_TITLES: Record<SalesDocumentType, string> = {
  proforma: "Proformas",
  invoice: "Invoices",
  advance: "Advance invoices",
  credit_note: "Credit notes",
};

export async function DocumentDetailPage({
  type,
  id,
  searchParams = {},
}: {
  type: SalesDocumentType;
  id: string;
  searchParams?: RawSearchParams;
}) {
  const { ctx, repo } = await requirePageRepo(DOCUMENT_PERMISSIONS[type].view);
  // Don't block the document paint on overdue sync — run after the response.
  after(() => {
    void refreshOverdue(repo);
  });
  const bundle = await repo.documents.get(id);
  if (!bundle || !isSalesDocumentType(bundle.document.document_type)) notFound();

  // /sales/invoices/<id> for a proforma (or the reverse) goes to the right section.
  if (bundle.document.document_type !== type) redirect(documentRouteFor(bundle.document.document_type, id));

  const doc = bundle.document;
  const settings = await repo.organization.getSettings();
  const requireApproval = settings?.require_approval ?? false;
  const alreadyConverted = type === "proforma" ? (await repo.documents.findConvertedInvoices(id)).length > 0 : false;
  const actions = getDocumentActions(doc, ctx.role, { requireApproval, alreadyConverted });
  const label = DOCUMENT_TYPE_LABELS[type];
  const today = todayISO();

  const back = (
    <Link href={DOCUMENT_ROUTES[type]} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> {PLURAL_TITLES[type]}
    </Link>
  );

  // Builder types open in the editor for drafts and issued documents (void stays read-only).
  if (isBuilderDocumentType(type) && actions.edit) {
    const data = await loadBuilderData(repo);
    if (!data) {
      return (
        <>
          {back}
          <PageHeader title={doc.number ? `${label} ${doc.number}` : `${label} draft`} />
          <Alert variant="destructive">
            <AlertDescription>
              Organization settings are missing, so this document cannot be edited yet. Check Settings or database setup,
              then reopen it to edit.
            </AlertDescription>
          </Alert>
          <DocumentActionBar documentId={id} documentType={type} actions={actions} />
        </>
      );
    }
    const isDraft = doc.status === "draft";
    const creditableEdit =
      !isDraft && type === "invoice" ? (await loadCreditContext(repo, id)).remainingTTC : undefined;
    const lifecycleEdit = !isDraft
      ? getLifecycleActions(doc, ctx.role, { creditableRemaining: creditableEdit })
      : null;
    const availableEdit =
      lifecycleEdit?.applyAdvance && type === "invoice"
        ? await listAvailableAdvances(repo, doc.customer_id, doc.currency)
        : [];

    return (
      <>
        {back}
        <PageHeader
          title={isDraft ? `Edit ${label.toLowerCase()} draft` : `Edit ${label.toLowerCase()} ${doc.number ?? ""}`.trim()}
          description={
            isDraft
              ? "Save changes anytime. Issue when ready to assign the official number."
              : "Changes keep the same official number and regenerate the PDF."
          }
        />
        {lifecycleEdit && (
          <DocumentLifecycleBar
            documentId={id}
            documentType={type}
            documentNumber={doc.number}
            currency={doc.currency}
            customerId={doc.customer_id}
            customerEmail={bundle.customer?.email ?? null}
            actions={lifecycleEdit}
            availableAdvances={availableEdit.map((a) => ({
              id: a.advance.id,
              number: a.advance.number ?? "advance",
              remaining: a.remaining,
            }))}
          />
        )}
        <DocumentBuilder
          documentType={type}
          documentId={id}
          initial={builderStateFromBundle(bundle, data.defaults.paymentTermsDays)}
          approval={{ status: doc.approval_status, note: doc.approval_note }}
          status={doc.status}
          documentNumber={doc.number}
          customers={data.customers}
          catalog={data.catalog}
          taxRates={data.taxRates}
          withholdingTypes={data.withholdingTypes}
          vatEnabled={data.vatEnabled}
          defaults={data.defaults}
          actions={actions}
          canSave={actions.edit}
        />
      </>
    );
  }

  // ---- Read-only / void documents: lifecycle actions, tabs ---------------------------------------------
  const receivable = isReceivableType(doc.document_type);
  const creditable = type === "invoice" && doc.status !== "draft" && doc.status !== "void" ? (await loadCreditContext(repo, id)).remainingTTC : undefined;
  const lifecycle = getLifecycleActions(doc, ctx.role, { creditableRemaining: creditable });
  const available =
    lifecycle.applyAdvance && type === "invoice" ? await listAvailableAdvances(repo, doc.customer_id, doc.currency) : [];

  const tabParam = param(searchParams, "tab");
  const tabs = [
    { id: "overview", title: "Overview" },
    ...(receivable && doc.status !== "draft" ? [{ id: "payments", title: "Payments" }] : []),
    ...(doc.status !== "draft" ? [{ id: "activity", title: "Activity" }, { id: "sharing", title: "Email and link" }] : []),
  ];
  const tab = tabs.some((t) => t.id === tabParam) ? tabParam : "overview";
  const base = `${DOCUMENT_ROUTES[type]}/${id}`;

  const linked = await loadLinked(repo, id);
  const showEmbeddedPdf = actions.pdf || hasPermission(ctx.role, DOCUMENT_PERMISSIONS[type].view);

  let body: React.ReactNode;
  if (tab === "payments") {
    const [payments, creditLinks, advanceLinks] = await Promise.all([
      repo.payments.forDocument(id),
      repo.settlement.creditLinks({ invoiceId: id }),
      repo.settlement.advanceLinks(type === "advance" ? { advanceId: id } : { invoiceId: id }),
    ]);
    const creditRefs = await Promise.all(
      creditLinks.map(async (link) => ({ link, ...(await numberAndHref(repo, link.credit_note_id)) })),
    );
    const advanceRefs = await Promise.all(
      advanceLinks.map(async (link) => ({
        link,
        // For an advance we show the invoice it was deducted from; for an invoice, the advance used.
        ...(await numberAndHref(repo, type === "advance" ? link.invoice_id : link.advance_document_id)),
      })),
    );
    const remainingOfAdvance = type === "advance" ? advanceRemaining(doc, advanceLinks) : null;
    body = (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settlement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {remainingOfAdvance !== null && doc.status === "paid" && (
            <p className="text-sm text-muted-foreground">Still available to deduct from a final invoice: {remainingOfAdvance.toLocaleString("fr-FR")} {doc.currency}.</p>
          )}
          <PaymentsPanel doc={doc} payments={payments} creditNotes={creditRefs} advances={advanceRefs} />
        </CardContent>
      </Card>
    );
  } else if (tab === "activity") {
    const entries = await repo.audit.list({ entityIds: [id], limit: 200 });
    body = (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline entries={entries} />
        </CardContent>
      </Card>
    );
  } else if (tab === "sharing") {
    const logs = await repo.emailLogs.listForDocument(id);
    const link = summarizeLink(doc);
    body = (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Secure public link</CardTitle>
          </CardHeader>
          <CardContent>
            <PublicLinkPanel
              documentId={id}
              status={link.status}
              createdAt={link.createdAt}
              expiresAt={link.expiresAt}
              canManage={lifecycle.manageLink}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Emails sent</CardTitle>
          </CardHeader>
          <CardContent>
            <EmailLogList logs={logs} />
          </CardContent>
        </Card>
      </div>
    );
  } else {
    body = (
      <>
        <DocumentView bundle={bundle} today={today} linked={linked} />
        {showEmbeddedPdf && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PDF</CardTitle>
            </CardHeader>
            <CardContent>
              <iframe title={`${label} PDF`} src={`/api/documents/${id}/pdf`} className="h-[80vh] w-full rounded-md border" />
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader title={`${label} ${doc.number ?? "(draft)"}`} description={doc.subject ?? undefined} />
      <DocumentActionBar documentId={id} documentType={type} actions={actions} />
      <DocumentLifecycleBar
        documentId={id}
        documentType={type}
        documentNumber={doc.number}
        currency={doc.currency}
        customerId={doc.customer_id}
        customerEmail={bundle.customer?.email ?? null}
        actions={lifecycle}
        availableAdvances={available.map((a) => ({ id: a.advance.id, number: a.advance.number ?? "advance", remaining: a.remaining }))}
      />
      {doc.status !== "draft" && <DocumentTabs base={base} active={tab} tabs={tabs} />}
      {body}
    </>
  );
}
