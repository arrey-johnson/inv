import { hasPermission } from "@/lib/auth/rbac";
import { isPayableDocument } from "@/lib/payments/settlement";
import type { DocumentRow, UserRole } from "@/types/database";
import { DOCUMENT_PERMISSIONS, isReceivableType, isSalesDocumentType } from "./status";

/**
 * What can be done to a document AFTER it has been issued. (`getDocumentActions` in status.ts covers the
 * draft workflow.) Used by the UI to show buttons and by the services to refuse anything else.
 */
export interface LifecycleActions {
  recordPayment: boolean;
  createCreditNote: boolean;
  applyAdvance: boolean;
  /** Cancel (void) the document: the number is kept and a CANCELLED watermark is printed. */
  voidDocument: boolean;
  /** Why voiding is not possible right now (shown next to the disabled action). */
  voidBlockedReason: string | null;
  acceptProforma: boolean;
  declineProforma: boolean;
  markExpired: boolean;
  sendEmail: boolean;
  manageLink: boolean;
}

const NONE: LifecycleActions = {
  recordPayment: false,
  createCreditNote: false,
  applyAdvance: false,
  voidDocument: false,
  voidBlockedReason: null,
  acceptProforma: false,
  declineProforma: false,
  markExpired: false,
  sendEmail: false,
  manageLink: false,
};

type LifecycleDoc = Pick<
  DocumentRow,
  "document_type" | "status" | "balance_due" | "paid_amount" | "credited_amount" | "advance_applied_amount" | "total_ttc"
>;

/** Reason a document cannot be voided, or null when it can. Shared with the void service. */
export function voidBlockedReason(doc: LifecycleDoc): string | null {
  if (doc.status === "draft") return "Drafts are deleted, not cancelled.";
  if (doc.status === "void") return "This document is already cancelled.";
  if (doc.document_type === "proforma" && doc.status === "converted") {
    return "This proforma was converted into an invoice. Cancel the invoice instead.";
  }
  if (isReceivableType(doc.document_type)) {
    if (doc.paid_amount > 0) return "Payments are recorded against it. Cancel (void) those payments first.";
    if (doc.credited_amount > 0) return "Credit notes are applied to it. Cancel those credit notes first.";
    if (doc.advance_applied_amount > 0) return "Advances are deducted from it. They must be released first.";
  }
  return null;
}

export function getLifecycleActions(
  doc: LifecycleDoc,
  role: UserRole | null | undefined,
  options: { creditableRemaining?: number } = {},
): LifecycleActions {
  if (!isSalesDocumentType(doc.document_type) || doc.status === "draft") return NONE;

  const perms = DOCUMENT_PERMISSIONS[doc.document_type];
  const issuedAndLive = doc.status !== "void";
  const blocked = voidBlockedReason(doc);
  const isProforma = doc.document_type === "proforma";
  const respondable = isProforma && (doc.status === "issued" || doc.status === "sent");

  return {
    recordPayment:
      isReceivableType(doc.document_type) && isPayableDocument({ ...doc, balance_due: doc.balance_due }) && hasPermission(role, "payments.create"),
    createCreditNote:
      doc.document_type === "invoice" &&
      issuedAndLive &&
      doc.status !== "credited" &&
      (options.creditableRemaining === undefined || options.creditableRemaining > 0) &&
      hasPermission(role, "credit_notes.create") &&
      hasPermission(role, "credit_notes.issue"),
    applyAdvance:
      doc.document_type === "invoice" &&
      isPayableDocument(doc) &&
      hasPermission(role, "advances.apply"),
    voidDocument: blocked === null && hasPermission(role, perms.void),
    voidBlockedReason: hasPermission(role, perms.void) ? blocked : null,
    acceptProforma: respondable && hasPermission(role, perms.update),
    declineProforma: respondable && hasPermission(role, perms.update),
    markExpired: respondable && hasPermission(role, perms.update),
    sendEmail: issuedAndLive && hasPermission(role, perms.send),
    manageLink: issuedAndLive && hasPermission(role, perms.send),
  };
}
