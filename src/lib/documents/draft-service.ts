import type { Repository } from "@/lib/data/types";
import { addDaysISO, todayISO } from "@/lib/utils/date-math";
import type { DocumentRow } from "@/types/database";
import {
  buildDraftWrite,
  resolveDocumentInput,
  resolvedFromBundle,
  type ResolvedDocument,
} from "./build";
import type { DocumentInput } from "./schema";
import {
  ServiceError,
  calculateOrThrow,
  loadBundle,
  loadSettings,
  need,
  toServiceError,
  type Actor,
} from "./service-support";
import { buildCustomerSnapshot, buildIssuerSnapshot } from "./snapshots";
import {
  DOCUMENT_PERMISSIONS,
  assertDraft,
  isBuilderDocumentType,
  isEditableDocumentStatus,
  isReceivableType,
} from "./status";
import { sha256Hex, type IssueDependencies } from "./issue-service";

async function requireActiveCustomer(repo: Repository, customerId: string) {
  const customer = await repo.customers.get(customerId);
  if (!customer) throw new ServiceError("The selected customer does not exist.", "invalid");
  return customer;
}

/** Invoices get a due date from the payment terms when the user left it blank. */
function applyDateDefaults(doc: ResolvedDocument, termsDays: number): ResolvedDocument {
  if (isReceivableType(doc.documentType) && !doc.dueDate) {
    return { ...doc, dueDate: addDaysISO(doc.issueDate, termsDays) };
  }
  return doc;
}

/**
 * Create or update a DRAFT.
 *
 *  - Server-authoritative: tax rates come from the database and every amount is recomputed here with
 *    `calculateDocument`; whatever totals the browser displayed are ignored.
 *  - NO official number is ever assigned here (numbers are allocated by `issue`).
 *  - Editing a draft clears any approval (approved content must not change silently).
 */
export async function saveDraft(
  repo: Repository,
  actor: Actor,
  input: DocumentInput,
  existingId?: string,
): Promise<DocumentRow> {
  try {
    const perms = DOCUMENT_PERMISSIONS[input.documentType];
    need(actor, existingId ? perms.update : perms.create);

    const [settings, taxRates, withholdingTypes, customer] = await Promise.all([
      loadSettings(repo),
      repo.taxes.listRates(),
      repo.taxes.listWithholdings(),
      requireActiveCustomer(repo, input.customerId),
    ]);

    let convertedFrom: string | null = null;
    if (existingId) {
      const existing = await loadBundle(repo, existingId);
      assertDraft(existing.document);
      if (existing.document.document_type !== input.documentType) {
        throw new ServiceError("The document type cannot be changed after creation.", "invalid");
      }
      convertedFrom = existing.document.converted_from_document_id;
    } else if (!customer.is_active) {
      throw new ServiceError("The selected customer is inactive.", "invalid");
    }

    const resolved = resolveDocumentInput(input, taxRates, { vatEnabled: settings.vat_registered, withholdingTypes });
    const withDefaults = applyDateDefaults(resolved, customer.payment_terms_days ?? settings.default_payment_terms_days);
    const calc = calculateOrThrow(withDefaults);
    const write = buildDraftWrite(withDefaults, calc, { convertedFromDocumentId: convertedFrom });

    const saved = existingId
      ? await repo.documents.replaceDraft(existingId, write)
      : await repo.documents.insertDraft(write);

    await repo.writeAudit({
      action: existingId ? "document.update" : "document.create",
      entityType: "document",
      entityId: saved.id,
      metadata: { type: saved.document_type, total_ttc: saved.total_ttc, status: saved.status },
    });
    return saved;
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export interface AmendOutcome {
  document: DocumentRow;
  pdfError: string | null;
  pdfSha256: string | null;
}

/**
 * Edit an already-issued document in place. Keeps the official number and issue stamp, recalculates
 * totals, refreshes party snapshots, recomputes settlement, and regenerates the PDF.
 */
export async function amendIssuedDocument(
  repo: Repository,
  actor: Actor,
  input: DocumentInput,
  existingId: string,
  deps: IssueDependencies,
): Promise<AmendOutcome> {
  try {
    const perms = DOCUMENT_PERMISSIONS[input.documentType];
    need(actor, perms.update);

    const existing = await loadBundle(repo, existingId);
    const doc = existing.document;
    if (!isBuilderDocumentType(doc.document_type)) {
      throw new ServiceError("This document type cannot be edited here.", "invalid");
    }
    if (doc.document_type !== input.documentType) {
      throw new ServiceError("The document type cannot be changed after creation.", "invalid");
    }
    if (!isEditableDocumentStatus(doc.status) || doc.status === "draft") {
      throw new ServiceError(
        doc.status === "void"
          ? "Voided documents cannot be edited."
          : doc.status === "draft"
            ? "Use Save draft for draft documents."
            : `Document ${doc.number ?? existingId} cannot be edited in status ${doc.status}.`,
        "immutable",
      );
    }

    const [settings, taxRates, withholdingTypes, customer, organization, destinations] = await Promise.all([
      loadSettings(repo),
      repo.taxes.listRates(),
      repo.taxes.listWithholdings(),
      requireActiveCustomer(repo, input.customerId),
      repo.organization.get(),
      repo.paymentDestinations.list(),
    ]);
    if (!organization) throw new ServiceError("Company profile is missing.", "invalid");

    const resolved = resolveDocumentInput(input, taxRates, { vatEnabled: settings.vat_registered, withholdingTypes });
    const withDefaults = applyDateDefaults(resolved, customer.payment_terms_days ?? settings.default_payment_terms_days);
    const calc = calculateOrThrow(withDefaults);
    if (calc.totalTTC <= 0) throw new ServiceError("The document total must be greater than zero.", "invalid");

    const write = buildDraftWrite(withDefaults, calc, {
      convertedFromDocumentId: doc.converted_from_document_id,
      approval: {
        approval_status: doc.approval_status,
        approval_requested_by: doc.approval_requested_by,
        approval_requested_at: doc.approval_requested_at,
        approved_by: doc.approved_by,
        approved_at: doc.approved_at,
        approval_note: doc.approval_note,
      },
    });

    const saved = await repo.documents.replaceIssuedContent(existingId, write, {
      customerSnapshot: buildCustomerSnapshot(customer),
      issuerSnapshot: buildIssuerSnapshot(organization, settings, destinations),
    });

    await repo.writeAudit({
      action: "document.amend",
      entityType: "document",
      entityId: saved.id,
      before: { total_ttc: doc.total_ttc, tax_total: doc.tax_total, net_ht: doc.net_ht },
      after: { total_ttc: saved.total_ttc, tax_total: saved.tax_total, net_ht: saved.net_ht },
      metadata: {
        type: saved.document_type,
        number: saved.number,
        status: saved.status,
        summary: `Amended issued ${saved.document_type} ${saved.number ?? saved.id}`,
      },
    });

    let pdfSha256: string | null = null;
    let pdfError: string | null = null;
    try {
      const pdf = await deps.renderPdf(repo, existingId);
      pdfSha256 = sha256Hex(pdf.bytes);
      await repo.documents.storePdf(existingId, {
        sha256: pdfSha256,
        generatedAt: new Date().toISOString(),
        bytes: pdf.bytes,
      });
      await repo.writeAudit({
        action: "document.pdf_stored",
        entityType: "document",
        entityId: existingId,
        metadata: { sha256: pdfSha256, number: saved.number, reason: "amend" },
      });
    } catch (cause) {
      pdfError = cause instanceof Error ? cause.message : "PDF generation failed";
      console.error("[amend] PDF generation failed after edit", existingId, cause);
    }

    const final = (await repo.documents.get(existingId))?.document ?? saved;
    return { document: final, pdfError, pdfSha256 };
  } catch (cause) {
    throw toServiceError(cause);
  }
}

/**
 * Create or update a document from the builder: drafts go through `saveDraft`, issued documents
 * through `amendIssuedDocument` (number kept, PDF regenerated).
 */
export async function saveDocument(
  repo: Repository,
  actor: Actor,
  input: DocumentInput,
  existingId: string | undefined,
  deps: IssueDependencies,
): Promise<{ document: DocumentRow; pdfError: string | null }> {
  if (!existingId) {
    const document = await saveDraft(repo, actor, input);
    return { document, pdfError: null };
  }
  const bundle = await loadBundle(repo, existingId);
  if (bundle.document.status === "draft") {
    const document = await saveDraft(repo, actor, input, existingId);
    return { document, pdfError: null };
  }
  const outcome = await amendIssuedDocument(repo, actor, input, existingId, deps);
  return { document: outcome.document, pdfError: outcome.pdfError };
}

export async function deleteDraft(repo: Repository, actor: Actor, id: string): Promise<void> {
  try {
    const bundle = await loadBundle(repo, id);
    const doc = bundle.document;
    if (!isBuilderDocumentType(doc.document_type)) throw new ServiceError("Unsupported document type.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS[doc.document_type].update);
    assertDraft(doc);

    await repo.documents.deleteDraft(id);
    await repo.writeAudit({
      action: "document.delete_draft",
      entityType: "document",
      entityId: id,
      metadata: { type: doc.document_type },
    });

    // A deleted draft invoice releases its source proforma so it can be converted again.
    if (doc.converted_from_document_id) {
      const remaining = await repo.documents.findConvertedInvoices(doc.converted_from_document_id);
      const source = await repo.documents.get(doc.converted_from_document_id);
      if (source && remaining.length === 0 && source.document.status === "converted") {
        await repo.documents.patchWorkflow(source.document.id, { status: "issued" });
      }
    }
  } catch (cause) {
    throw toServiceError(cause);
  }
}

/** Copy any document (even an issued one) into a brand-new DRAFT with no number. */
export async function duplicateDocument(repo: Repository, actor: Actor, id: string): Promise<DocumentRow> {
  try {
    const source = await loadBundle(repo, id);
    const type = source.document.document_type;
    if (!isBuilderDocumentType(type)) throw new ServiceError("Unsupported document type.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS[type].view);
    need(actor, DOCUMENT_PERMISSIONS[type].create);

    const [settings, customer] = await Promise.all([loadSettings(repo), repo.customers.get(source.document.customer_id)]);
    if (!customer) throw new ServiceError("The customer of this document no longer exists.", "invalid");

    const today = todayISO();
    const copy: ResolvedDocument = {
      ...resolvedFromBundle(source),
      issueDate: today,
      dueDate: isReceivableType(type) ? addDaysISO(today, customer.payment_terms_days ?? settings.default_payment_terms_days) : null,
      validUntil: type === "proforma" ? addDaysISO(today, settings.proforma_validity_days) : null,
    };
    const calc = calculateOrThrow(copy);
    const draft = await repo.documents.insertDraft(buildDraftWrite(copy, calc));
    await repo.documents.link(id, draft.id, "duplicate_of");
    await repo.writeAudit({
      action: "document.duplicate",
      entityType: "document",
      entityId: draft.id,
      metadata: { source_id: id, source_number: source.document.number },
    });
    return draft;
  } catch (cause) {
    throw toServiceError(cause);
  }
}
