import { describe, expect, it } from "vitest";
import type { DocumentStatus, DocumentType, UserRole } from "@/types/database";
import { assertDraft, DocumentStateError, effectiveStatus, getDocumentActions } from "../status";

type Doc = { document_type: DocumentType; status: DocumentStatus; approval_status: "none" | "pending" | "approved" | "rejected" };
const doc = (over: Partial<Doc> = {}): Doc => ({
  document_type: "invoice",
  status: "draft",
  approval_status: "none",
  ...over,
});
const actions = (d: Doc, role: UserRole | null, requireApproval = false, alreadyConverted = false) =>
  getDocumentActions(d as never, role, { requireApproval, alreadyConverted });

describe("getDocumentActions", () => {
  it("lets an admin edit, delete and issue a draft", () => {
    const a = actions(doc(), "admin");
    expect(a).toMatchObject({ edit: true, deleteDraft: true, issue: true, pdf: true, duplicate: true, convert: false });
  });

  it("lets issued documents be edited but not deleted or re-issued; void stays locked", () => {
    for (const status of ["issued", "sent", "paid", "converted"] as const) {
      const a = actions(doc({ status }), "admin");
      expect(a.edit, status).toBe(true);
      expect(a.deleteDraft, status).toBe(false);
      expect(a.issue, status).toBe(false);
    }
    const voided = actions(doc({ status: "void" }), "admin");
    expect(voided.edit).toBe(false);
    expect(voided.deleteDraft).toBe(false);
    expect(voided.issue).toBe(false);
  });

  it("viewers can look but not change anything", () => {
    const a = actions(doc(), "viewer");
    expect(a).toMatchObject({ edit: false, issue: false, duplicate: false, deleteDraft: false });
    expect(a.pdf).toBe(true);
  });

  it("gates issuing behind approval when required", () => {
    const needs = actions(doc(), "sales", true);
    expect(needs.issue).toBe(false);
    expect(needs.submitForApproval).toBe(true);
    expect(needs.issueBlockedReason).toMatch(/submit/i);

    const pending = actions(doc({ approval_status: "pending" }), "sales", true);
    expect(pending.submitForApproval).toBe(false);
    expect(pending.issueBlockedReason).toMatch(/waiting/i);

    expect(actions(doc({ approval_status: "approved" }), "admin", true).issue).toBe(true);
  });

  it("only approvers can approve or reject, and reject needs a pending request", () => {
    expect(actions(doc({ approval_status: "pending" }), "accountant", true)).toMatchObject({ approve: true, reject: true });
    expect(actions(doc({ approval_status: "pending" }), "sales", true)).toMatchObject({ approve: false, reject: false });
    expect(actions(doc(), "accountant", true)).toMatchObject({ approve: true, reject: false });
    expect(actions(doc(), "accountant", false)).toMatchObject({ approve: false });
  });

  it("converts only an issued/sent/accepted proforma that has not been converted yet", () => {
    const issuedProforma = doc({ document_type: "proforma", status: "issued" });
    expect(actions(issuedProforma, "admin").convert).toBe(true);
    expect(actions(issuedProforma, "admin", false, true).convert).toBe(false);
    expect(actions(doc({ document_type: "proforma", status: "draft" }), "admin").convert).toBe(false);
    expect(actions(doc({ document_type: "proforma", status: "converted" }), "admin").convert).toBe(false);
    expect(actions(doc({ document_type: "invoice", status: "issued" }), "admin").convert).toBe(false);
  });

  it("offers nothing for unsupported document types", () => {
    const a = actions(doc({ document_type: "credit_note" as DocumentType }), "admin");
    expect(Object.values(a).some((v) => v === true)).toBe(false);
  });
});

describe("effectiveStatus", () => {
  const invoice = { document_type: "invoice", status: "issued", due_date: "2026-01-10", balance_due: 500, valid_until: null } as const;

  it("shows open invoices past their due date as overdue", () => {
    expect(effectiveStatus(invoice as never, "2026-01-11")).toBe("overdue");
    expect(effectiveStatus(invoice as never, "2026-01-10")).toBe("issued");
  });

  it("does not mark settled invoices overdue", () => {
    expect(effectiveStatus({ ...invoice, balance_due: 0 } as never, "2026-02-01")).toBe("issued");
    expect(effectiveStatus({ ...invoice, status: "paid" } as never, "2026-02-01")).toBe("paid");
  });

  it("shows lapsed proformas as expired", () => {
    const proforma = { document_type: "proforma", status: "issued", due_date: null, balance_due: 0, valid_until: "2026-01-31" };
    expect(effectiveStatus(proforma as never, "2026-02-01")).toBe("expired");
    expect(effectiveStatus(proforma as never, "2026-01-31")).toBe("issued");
  });
});

describe("assertDraft", () => {
  it("throws a state error with the document number for non-drafts", () => {
    expect(() => assertDraft({ status: "draft", number: null })).not.toThrow();
    expect(() => assertDraft({ status: "issued", number: "PS-INV-2026-0001" })).toThrow(DocumentStateError);
    expect(() => assertDraft({ status: "issued", number: "PS-INV-2026-0001" })).toThrow(/PS-INV-2026-0001/);
  });
});
