import { hasPermission, type Permission } from "@/lib/auth/rbac";
import type { DocumentRow, DocumentStatus, DocumentType, UserRole } from "@/types/database";

/** Document types the editor (builder) handles: they are written as lines and issued from a draft. */
export type BuilderDocumentType = Extract<DocumentType, "invoice" | "proforma" | "advance">;

/** Every document type that goes through the numbering / issue / PDF pipeline. Credit notes have no editor. */
export type SalesDocumentType = BuilderDocumentType | Extract<DocumentType, "credit_note">;

export const SALES_DOCUMENT_TYPES: ReadonlyArray<SalesDocumentType> = ["proforma", "invoice", "advance", "credit_note"];

export const DOCUMENT_TYPE_LABELS: Record<SalesDocumentType, string> = {
  proforma: "Proforma",
  invoice: "Invoice",
  advance: "Advance invoice",
  credit_note: "Credit note",
};

export const DOCUMENT_ROUTES: Record<SalesDocumentType, string> = {
  proforma: "/sales/proformas",
  invoice: "/sales/invoices",
  advance: "/sales/advances",
  credit_note: "/sales/credit-notes",
};

type TypePermissions = Record<"view" | "create" | "update" | "issue" | "send" | "void", Permission>;

export const DOCUMENT_PERMISSIONS: Record<SalesDocumentType, TypePermissions> = {
  proforma: {
    view: "proformas.view",
    create: "proformas.create",
    update: "proformas.update",
    issue: "proformas.issue",
    send: "invoices.send",
    void: "invoices.void",
  },
  invoice: {
    view: "invoices.view",
    create: "invoices.create",
    update: "invoices.update",
    issue: "invoices.issue",
    send: "invoices.send",
    void: "invoices.void",
  },
  // Advance (deposit) invoices are invoices: they share the invoice permissions.
  advance: {
    view: "invoices.view",
    create: "invoices.create",
    update: "invoices.update",
    issue: "invoices.issue",
    send: "invoices.send",
    void: "invoices.void",
  },
  credit_note: {
    view: "credit_notes.view",
    create: "credit_notes.create",
    update: "credit_notes.create",
    issue: "credit_notes.issue",
    send: "credit_notes.issue",
    void: "credit_notes.void",
  },
};

export function isSalesDocumentType(type: DocumentType): type is SalesDocumentType {
  return type === "invoice" || type === "proforma" || type === "advance" || type === "credit_note";
}

export function isBuilderDocumentType(type: DocumentType): type is BuilderDocumentType {
  return type === "invoice" || type === "proforma" || type === "advance";
}

/** Documents that carry a due date and a balance: invoices and advance (deposit) invoices. */
export function isReceivableType(type: DocumentType): boolean {
  return type === "invoice" || type === "advance";
}

/** Invoice statuses that still expect money. */
const OPEN_INVOICE_STATUSES: ReadonlySet<DocumentStatus> = new Set(["issued", "sent", "partially_paid", "overdue"]);

export function isOpenInvoiceStatus(status: DocumentStatus): boolean {
  return OPEN_INVOICE_STATUSES.has(status);
}

/** Proforma statuses from which it can still be converted into an invoice. */
const CONVERTIBLE_PROFORMA_STATUSES: ReadonlySet<DocumentStatus> = new Set(["issued", "sent", "accepted"]);

/**
 * The status to DISPLAY: an open invoice past its due date shows as overdue even though the stored
 * status is only updated by the (future) scheduled job. Never used for business rules.
 */
export function effectiveStatus(
  doc: Pick<DocumentRow, "document_type" | "status" | "due_date" | "balance_due" | "valid_until">,
  today: string,
): DocumentStatus {
  if (
    isReceivableType(doc.document_type) &&
    isOpenInvoiceStatus(doc.status) &&
    doc.status !== "overdue" &&
    doc.due_date &&
    doc.due_date < today &&
    doc.balance_due > 0
  ) {
    return "overdue";
  }
  if (
    doc.document_type === "proforma" &&
    (doc.status === "issued" || doc.status === "sent") &&
    doc.valid_until &&
    doc.valid_until < today
  ) {
    return "expired";
  }
  return doc.status;
}

export interface DocumentActions {
  /** Edit lines/header. Allowed for drafts and issued (non-void) builder documents. */
  edit: boolean;
  deleteDraft: boolean;
  submitForApproval: boolean;
  approve: boolean;
  reject: boolean;
  issue: boolean;
  duplicate: boolean;
  convert: boolean;
  /** Always possible for a viewer of the document; drafts render with a DRAFT watermark. */
  pdf: boolean;
  /** Why `issue` is unavailable (shown as a hint), when there is a useful reason. */
  issueBlockedReason: string | null;
}

/** Statuses that may still be opened in the builder and saved. */
export function isEditableDocumentStatus(status: DocumentStatus): boolean {
  return status !== "void";
}

/**
 * Single source of truth for which buttons exist for a document (UI) and which actions are allowed
 * (server actions re-check with the same function). `requireApproval` comes from organization settings.
 */
export function getDocumentActions(
  doc: Pick<DocumentRow, "document_type" | "status" | "approval_status">,
  role: UserRole | null | undefined,
  options: { requireApproval: boolean; alreadyConverted?: boolean },
): DocumentActions {
  const none: DocumentActions = {
    edit: false,
    deleteDraft: false,
    submitForApproval: false,
    approve: false,
    reject: false,
    issue: false,
    duplicate: false,
    convert: false,
    pdf: false,
    issueBlockedReason: null,
  };
  // Credit notes have no editor and no draft workflow: their actions live in `getLifecycleActions`.
  if (!isBuilderDocumentType(doc.document_type)) return none;

  const perms = DOCUMENT_PERMISSIONS[doc.document_type];
  const canView = hasPermission(role, perms.view);
  const canUpdate = hasPermission(role, perms.update);
  const canIssue = hasPermission(role, perms.issue);
  const canApprove = hasPermission(role, "documents.approve");
  const isDraft = doc.status === "draft";

  const approved = doc.approval_status === "approved";
  const pending = doc.approval_status === "pending";
  const needsApproval = options.requireApproval && !approved;

  let issueBlockedReason: string | null = null;
  if (isDraft && needsApproval) {
    issueBlockedReason = pending
      ? "Approval is required before issuing: this document is waiting for approval."
      : "Approval is required before issuing: submit this document for approval first.";
  }

  return {
    edit: canUpdate && isEditableDocumentStatus(doc.status),
    deleteDraft: isDraft && canUpdate,
    submitForApproval: isDraft && canUpdate && options.requireApproval && !pending && !approved,
    // An approver may approve directly (without a prior submission) unless it is already approved.
    approve: isDraft && canApprove && options.requireApproval && !approved,
    reject: isDraft && canApprove && options.requireApproval && pending,
    issue: isDraft && canIssue && !needsApproval,
    duplicate: canView && hasPermission(role, perms.create),
    convert:
      doc.document_type === "proforma" &&
      CONVERTIBLE_PROFORMA_STATUSES.has(doc.status) &&
      !options.alreadyConverted &&
      hasPermission(role, "proformas.convert") &&
      hasPermission(role, "invoices.create"),
    pdf: canView,
    issueBlockedReason: isDraft && canIssue ? issueBlockedReason : null,
  };
}

export class DocumentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentStateError";
  }
}

/** Throws unless the document is still a draft (issue / delete-draft / approval paths). */
export function assertDraft(doc: Pick<DocumentRow, "status" | "number">): void {
  if (doc.status !== "draft") {
    throw new DocumentStateError(
      `${doc.number ?? "This document"} is ${doc.status}. Only drafts can be used for this action.`,
    );
  }
}
