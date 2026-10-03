import type { Repository } from "@/lib/data/types";
import { formatMoney } from "@/lib/finance/format";
import type { DocumentRow } from "@/types/database";
import { sha256Hex, type IssueDependencies } from "./issue-service";
import { voidBlockedReason } from "./lifecycle";
import { ServiceError, loadBundle, need, toServiceError, type Actor } from "./service-support";
import { DOCUMENT_PERMISSIONS, isSalesDocumentType } from "./status";

export interface VoidOutcome {
  document: DocumentRow;
  /** Invoices whose balance changed because a credit note was cancelled. */
  releasedInvoices: DocumentRow[];
  pdfError: string | null;
}

/**
 * Cancel an issued document. It is never deleted: the official number stays in the register with the
 * reason, the status becomes VOID and the PDF is re-rendered with a CANCELLED watermark.
 *
 * Refused while money or credits are attached (payments, credit notes, advances): those must be cancelled
 * first so the books stay consistent. Cancelling a credit note releases its credit, so the invoice balance
 * goes back up.
 */
export async function voidDocument(
  repo: Repository,
  actor: Actor,
  id: string,
  reason: string,
  deps: IssueDependencies,
): Promise<VoidOutcome> {
  try {
    const bundle = await loadBundle(repo, id);
    const doc = bundle.document;
    if (!isSalesDocumentType(doc.document_type)) throw new ServiceError("This document cannot be cancelled.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS[doc.document_type].void);

    const why = reason.trim();
    if (why.length < 5) throw new ServiceError("Give a reason for the cancellation (at least 5 characters).", "invalid");
    const blocked = voidBlockedReason(doc);
    if (blocked) throw new ServiceError(blocked, "conflict");

    const voided = await repo.documents.voidDocument(id, why);
    let releasedInvoices: DocumentRow[] = [];
    if (doc.document_type === "credit_note") {
      releasedInvoices = await repo.settlement.releaseCreditNote(id);
    }

    await repo.writeAudit({
      action: "document.void",
      entityType: "document",
      entityId: id,
      before: { status: doc.status },
      after: { status: "void" },
      metadata: {
        number: doc.number,
        type: doc.document_type,
        reason: why,
        total_ttc: doc.total_ttc,
        summary: `Cancelled: ${why}`,
      },
    });
    for (const invoice of releasedInvoices) {
      await repo.writeAudit({
        action: "document.void",
        entityType: "document",
        entityId: invoice.id,
        metadata: {
          credit_note_id: id,
          credit_note_number: doc.number,
          balance_due: invoice.balance_due,
          status: invoice.status,
          summary: `Credit note ${doc.number} cancelled (${formatMoney(doc.total_ttc, doc.currency)} no longer credited)`,
        },
      });
    }

    let pdfError: string | null = null;
    try {
      const pdf = await deps.renderPdf(repo, id);
      await repo.documents.storePdf(id, {
        sha256: sha256Hex(pdf.bytes),
        generatedAt: new Date().toISOString(),
        bytes: pdf.bytes,
      });
    } catch (cause) {
      pdfError = cause instanceof Error ? cause.message : "PDF generation failed";
      console.error("[void] could not re-render the cancelled PDF", id, cause);
    }
    return { document: (await repo.documents.get(id))?.document ?? voided, releasedInvoices, pdfError };
  } catch (cause) {
    throw toServiceError(cause);
  }
}

export const PROFORMA_RESPONSES = {
  accept: { status: "accepted", action: "document.accept", label: "accepted" },
  decline: { status: "rejected", action: "document.decline", label: "declined" },
  expire: { status: "expired", action: "document.expire", label: "marked as expired" },
} as const;
export type ProformaResponse = keyof typeof PROFORMA_RESPONSES;

/** The customer's answer to a proforma (or its validity running out). Numbers and amounts never change. */
export async function respondToProforma(
  repo: Repository,
  actor: Actor,
  id: string,
  response: ProformaResponse,
  note?: string | null,
): Promise<DocumentRow> {
  try {
    const bundle = await loadBundle(repo, id);
    const doc = bundle.document;
    if (doc.document_type !== "proforma") throw new ServiceError("Only proformas can be accepted or declined.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS.proforma.update);
    if (doc.status !== "issued" && doc.status !== "sent") {
      throw new ServiceError(
        doc.status === "draft"
          ? "Issue the proforma before recording the customer's answer."
          : `This proforma is already ${doc.status.replace(/_/g, " ")}.`,
        "conflict",
      );
    }
    const spec = PROFORMA_RESPONSES[response];
    const updated = await repo.documents.patchWorkflow(id, { status: spec.status });
    await repo.writeAudit({
      action: spec.action,
      entityType: "document",
      entityId: id,
      before: { status: doc.status },
      after: { status: spec.status },
      metadata: { number: doc.number, note: note?.trim() || null, summary: `Proforma ${spec.label}` },
    });
    return updated;
  } catch (cause) {
    throw toServiceError(cause);
  }
}
