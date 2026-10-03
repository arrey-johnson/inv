import { createHash } from "node:crypto";
import type { Repository } from "@/lib/data/types";
import { addDaysISO, todayISO } from "@/lib/utils/date-math";
import type { DocumentRow } from "@/types/database";
import {
  buildDraftWrite,
  resolvedFromBundle,
  storedTotalsMatch,
  type ResolvedDocument,
} from "./build";
import {
  ServiceError,
  calculateOrThrow,
  loadBundle,
  loadSettings,
  need,
  toServiceError,
  type Actor,
} from "./service-support";
import { DOCUMENT_PERMISSIONS, getDocumentActions, isSalesDocumentType } from "./status";
import { validateDocumentForIssue, type IssueIssue } from "./validate-issue";

/** Injected so the domain layer stays free of file/branding I/O (and tests can use the real renderer or a stub). */
export interface IssueDependencies {
  renderPdf: (repo: Repository, documentId: string) => Promise<{ bytes: Uint8Array; filename: string }>;
}

export interface IssueOutcome {
  document: DocumentRow;
  warnings: IssueIssue[];
  /** Set when the document was issued but the PDF could not be generated/stored (it can be regenerated on download). */
  pdfError: string | null;
  pdfSha256: string | null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * draft -> issued.
 *
 *  1. permission + approval gate
 *  2. server-side RECALCULATION from the stored lines (rewrites the draft if anything drifted)
 *  3. validation (`validateDocumentForIssue`) - blocking errors abort, warnings are returned
 *  4. atomic issue (repository / `issue_document` RPC): snapshots + official number + due dates
 *  5. PDF generation (letterhead + stamp), SHA-256 stored on the document
 */
export async function issueDocument(
  repo: Repository,
  actor: Actor,
  id: string,
  deps: IssueDependencies,
): Promise<IssueOutcome> {
  try {
    let bundle = await loadBundle(repo, id);
    const type = bundle.document.document_type;
    if (!isSalesDocumentType(type)) throw new ServiceError("Unsupported document type.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS[type].issue);

    const [settings, organization, destinations] = await Promise.all([
      loadSettings(repo),
      repo.organization.get(),
      repo.paymentDestinations.list(),
    ]);

    // Credit notes are created and issued in one step (no editor, no approval draft): permission is enough.
    const permitted =
      type === "credit_note"
        ? { issue: true, issueBlockedReason: null }
        : getDocumentActions(bundle.document, actor.role, { requireApproval: settings.require_approval });
    if (bundle.document.status !== "draft") {
      throw new ServiceError(`Only drafts can be issued (this document is ${bundle.document.status}).`, "immutable");
    }
    if (!permitted.issue) {
      throw new ServiceError(permitted.issueBlockedReason ?? "This document cannot be issued yet.", "conflict");
    }

    // 2. Recalculate from stored lines; persist the corrected totals if they drifted.
    const resolved = resolvedFromBundle(bundle);
    const calc = calculateOrThrow(resolved);
    if (!storedTotalsMatch(bundle.document, bundle.items, calc)) {
      await repo.documents.replaceDraft(
        id,
        buildDraftWrite(resolved, calc, {
          convertedFromDocumentId: bundle.document.converted_from_document_id,
          approval: bundle.document,
        }),
      );
      bundle = await loadBundle(repo, id);
    }

    // 3. Validate.
    const check = validateDocumentForIssue({
      document: bundle.document,
      items: bundle.items,
      withholdings: bundle.withholdings,
      customer: bundle.customer,
      organization,
      settings,
      destinations,
    });
    if (!check.ok) {
      throw new ServiceError(
        "This document cannot be issued yet.",
        "invalid",
        check.errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)),
      );
    }

    // 4. Atomic issue.
    const issued = await repo.documents.issue(id);
    await repo.writeAudit({
      action: "document.issue",
      entityType: "document",
      entityId: id,
      metadata: { type, number: issued.number, total_ttc: issued.total_ttc, warnings: check.warnings.length },
    });

    // 5. Generate + store the PDF. A failure here never un-issues the document.
    let pdfSha256: string | null = null;
    let pdfError: string | null = null;
    try {
      const pdf = await deps.renderPdf(repo, id);
      pdfSha256 = sha256Hex(pdf.bytes);
      await repo.documents.storePdf(id, { sha256: pdfSha256, generatedAt: new Date().toISOString(), bytes: pdf.bytes });
      await repo.writeAudit({
        action: "document.pdf_stored",
        entityType: "document",
        entityId: id,
        metadata: { sha256: pdfSha256, number: issued.number },
      });
    } catch (cause) {
      pdfError = cause instanceof Error ? cause.message : "PDF generation failed";
      console.error("[issue] PDF generation failed after issuing", id, cause);
    }

    const final = (await repo.documents.get(id))?.document ?? issued;
    return { document: final, warnings: check.warnings, pdfError, pdfSha256 };
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export interface ConvertOutcome {
  invoice: DocumentRow;
  /** Present when the new invoice was also issued (it then has its own official number). */
  issue: IssueOutcome | null;
  /** Why the invoice was left as a draft (approval required or no issue permission). */
  draftReason: string | null;
}

/**
 * Proforma -> invoice. The proforma stays untouched (immutable); a NEW invoice is created from its
 * lines with `converted_from_document_id` pointing back, then issued immediately when the actor may do so
 * (otherwise it is left as a draft). The proforma is marked `converted` so it cannot be converted twice.
 */
export async function convertProformaToInvoice(
  repo: Repository,
  actor: Actor,
  proformaId: string,
  deps: IssueDependencies,
): Promise<ConvertOutcome> {
  try {
    need(actor, "proformas.convert");
    need(actor, "invoices.create");

    const source = await loadBundle(repo, proformaId);
    if (source.document.document_type !== "proforma") {
      throw new ServiceError("Only proformas can be converted into invoices.", "invalid");
    }
    const settings = await loadSettings(repo);
    const existing = await repo.documents.findConvertedInvoices(proformaId);
    const permitted = getDocumentActions(source.document, actor.role, {
      requireApproval: settings.require_approval,
      alreadyConverted: existing.length > 0,
    });
    if (!permitted.convert) {
      throw new ServiceError(
        existing.length > 0
          ? "This proforma has already been converted into an invoice."
          : `A ${source.document.status} proforma cannot be converted.`,
        "conflict",
      );
    }

    const customer = await repo.customers.get(source.document.customer_id);
    if (!customer) throw new ServiceError("The customer of this proforma no longer exists.", "invalid");

    const today = todayISO();
    const invoiceDoc: ResolvedDocument = {
      ...resolvedFromBundle(source),
      documentType: "invoice",
      issueDate: today,
      dueDate: addDaysISO(today, customer.payment_terms_days ?? settings.default_payment_terms_days),
      validUntil: null,
      reference: source.document.reference ?? source.document.number,
    };
    const calc = calculateOrThrow(invoiceDoc);
    const invoice = await repo.documents.insertDraft(
      buildDraftWrite(invoiceDoc, calc, { convertedFromDocumentId: proformaId }),
    );
    await repo.documents.link(proformaId, invoice.id, "converted_to");
    await repo.documents.patchWorkflow(proformaId, { status: "converted" });
    await repo.writeAudit({
      action: "document.convert",
      entityType: "document",
      entityId: invoice.id,
      metadata: { from_proforma_id: proformaId, from_number: source.document.number },
    });

    const invoiceActions = getDocumentActions(invoice, actor.role, { requireApproval: settings.require_approval });
    if (!invoiceActions.issue) {
      return {
        invoice,
        issue: null,
        draftReason: invoiceActions.issueBlockedReason ?? "You do not have permission to issue invoices; it was saved as a draft.",
      };
    }
    try {
      const issue = await issueDocument(repo, actor, invoice.id, deps);
      return { invoice: issue.document, issue, draftReason: null };
    } catch (cause) {
      // The conversion itself succeeded; the invoice stays a draft the user can fix and issue.
      const failure = toServiceError(cause);
      return { invoice, issue: null, draftReason: [failure.message, ...failure.details].join(" ") };
    }
  } catch (cause) {
    throw toServiceError(cause);
  }
}
