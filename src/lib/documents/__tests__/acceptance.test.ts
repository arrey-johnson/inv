import { beforeAll, describe, expect, it } from "vitest";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { todayISO } from "@/lib/utils/date-math";
import { approveDocument, rejectDocument, submitForApproval } from "../approval-service";
import { deleteDraft, duplicateDocument, saveDocument, saveDraft } from "../draft-service";
import { convertProformaToInvoice, issueDocument, sha256Hex, type IssueDependencies } from "../issue-service";
import { ServiceError } from "../service-support";
import { makeRepository, parseInput, seedCustomer, standardVat } from "./fixtures";

const admin = { role: "admin" } as const;
const year = new Date().getFullYear();
const deps: IssueDependencies = { renderPdf: renderRepositoryDocumentPdf };

beforeAll(() => {
  // Demo mode: branding is read from assets/branding/source without server secrets.
  process.env.DEMO_MODE = "true";
});

async function setup() {
  const { repo, store } = makeRepository();
  const customer = await seedCustomer(repo);
  const vat = await standardVat(repo);
  return { repo, store, customer, vat };
}

describe("acceptance path (demo repository)", () => {
  it("1M HT at 19.25% VAT = 192,500 VAT / 1,192,500 TTC, saved as a draft WITHOUT a number", async () => {
    const { repo, customer, vat } = await setup();
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));

    expect(draft.status).toBe("draft");
    expect(draft.number).toBeNull();
    expect(draft.net_ht).toBe(1_000_000);
    expect(draft.tax_total).toBe(192_500);
    expect(draft.total_ttc).toBe(1_192_500);
  });

  it("10% global discount = 173,250 VAT / 1,073,250 TTC", async () => {
    const { repo, customer, vat } = await setup();
    const draft = await saveDraft(
      repo,
      admin,
      parseInput({ customerId: customer.id, globalDiscountType: "percentage", globalDiscountValue: "10" }, vat.id),
    );
    expect(draft.global_discount_amount).toBe(100_000);
    expect(draft.net_ht).toBe(900_000);
    expect(draft.tax_total).toBe(173_250);
    expect(draft.total_ttc).toBe(1_073_250);
  });

  it("issues a proforma (number + PDF hash), converts it to an invoice with a NEW number, and is immutable afterwards", async () => {
    const { repo, customer, vat } = await setup();
    const draft = await saveDraft(
      repo,
      admin,
      parseInput({ customerId: customer.id, globalDiscountType: "percentage", globalDiscountValue: "10" }, vat.id),
    );

    const issued = await issueDocument(repo, admin, draft.id, deps);
    expect(issued.document.status).toBe("issued");
    expect(issued.document.number).toBe(`PS-PF-${year}-0001`);
    expect(issued.pdfError).toBeNull();
    expect(issued.document.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.document.customer_snapshot).toMatchObject({ name: "Acme Cameroon SARL", niu: "TEST-NIU-001" });

    // The stored PDF hash is reproducible: re-rendering an issued document yields identical bytes.
    const again = await renderRepositoryDocumentPdf(repo, draft.id);
    expect(sha256Hex(again.bytes)).toBe(issued.document.pdf_sha256);
    expect(Buffer.from(again.bytes.slice(0, 5)).toString()).toBe("%PDF-");

    // Issued documents can be amended in place (number kept); delete / re-issue stay refused.
    const amended = await saveDocument(
      repo,
      admin,
      parseInput(
        {
          customerId: customer.id,
          globalDiscountType: "percentage",
          globalDiscountValue: "10",
          reference: "UPDATED-PO",
          subject: "Amended subject",
        },
        vat.id,
      ),
      draft.id,
      deps,
    );
    expect(amended.document.number).toBe(`PS-PF-${year}-0001`);
    expect(amended.document.status).toBe("issued");
    expect(amended.document.reference).toBe("UPDATED-PO");
    expect(amended.document.subject).toBe("Amended subject");
    expect(amended.document.total_ttc).toBe(1_073_250);
    await expect(deleteDraft(repo, admin, draft.id)).rejects.toMatchObject({ code: "immutable" });
    await expect(issueDocument(repo, admin, draft.id, deps)).rejects.toBeInstanceOf(ServiceError);

    // Convert -> new invoice, new number, linked to the source.
    const converted = await convertProformaToInvoice(repo, admin, draft.id, deps);
    expect(converted.issue).not.toBeNull();
    expect(converted.invoice.document_type).toBe("invoice");
    expect(converted.invoice.number).toBe(`PS-INV-${year}-0001`);
    expect(converted.invoice.status).toBe("issued");
    expect(converted.invoice.converted_from_document_id).toBe(draft.id);
    expect(converted.invoice.total_ttc).toBe(1_073_250);
    expect(converted.invoice.balance_due).toBe(1_073_250);
    expect(converted.invoice.due_date).not.toBeNull();

    const proforma = await repo.documents.get(draft.id);
    expect(proforma?.document.status).toBe("converted");
    expect(proforma?.document.number).toBe(`PS-PF-${year}-0001`); // unchanged

    // A proforma can only be converted once.
    await expect(convertProformaToInvoice(repo, admin, draft.id, deps)).rejects.toMatchObject({ code: "conflict" });
  });

  it("issued invoice PDF is stamped; draft PDF is watermarked and unstamped", async () => {
    const { repo, customer, vat } = await setup();
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
    const draftPdf = await renderRepositoryDocumentPdf(repo, draft.id);
    const issued = await issueDocument(repo, admin, draft.id, deps);
    const issuedPdf = await renderRepositoryDocumentPdf(repo, draft.id);

    // The stamped PDF embeds an extra image XObject, so it is clearly larger than the draft.
    expect(issuedPdf.bytes.length).toBeGreaterThan(draftPdf.bytes.length);
    expect(issued.document.number).toBe(`PS-INV-${year}-0001`);
    expect(issuedPdf.filename).toBe(`PS-INV-${year}-0001.pdf`);
    expect(draftPdf.filename.startsWith("draft-")).toBe(true);
  });

  it("duplicate creates a new unnumbered draft with the same lines", async () => {
    const { repo, customer, vat } = await setup();
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
    await issueDocument(repo, admin, draft.id, deps);
    const copy = await duplicateDocument(repo, admin, draft.id);

    expect(copy.id).not.toBe(draft.id);
    expect(copy.status).toBe("draft");
    expect(copy.number).toBeNull();
    expect(copy.total_ttc).toBe(1_192_500);
    expect(copy.issue_date).toBe(todayISO());
  });

  it("deleting a draft invoice created by conversion releases the proforma", async () => {
    const { repo, customer, vat } = await setup();
    // sales cannot issue invoices only when approval is required; force a draft invoice via approval gate
    await repo.organization.updateSettings({ require_approval: true });
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
    await approveDocument(repo, admin, draft.id);
    await issueDocument(repo, admin, draft.id, deps);

    const converted = await convertProformaToInvoice(repo, admin, draft.id, deps);
    expect(converted.issue).toBeNull(); // approval required -> stays a draft
    expect(converted.draftReason).toMatch(/approval/i);
    expect((await repo.documents.get(draft.id))?.document.status).toBe("converted");

    await deleteDraft(repo, admin, converted.invoice.id);
    expect((await repo.documents.get(draft.id))?.document.status).toBe("issued");
  });
});

describe("approval workflow", () => {
  it("blocks issue until approved, and editing clears the approval", async () => {
    const { repo, customer, vat } = await setup();
    await repo.organization.updateSettings({ require_approval: true });
    const sales = { role: "sales" } as const;

    const draft = await saveDraft(repo, sales, parseInput({ customerId: customer.id }, vat.id));
    await expect(issueDocument(repo, sales, draft.id, deps)).rejects.toMatchObject({ code: "conflict" });

    const pending = await submitForApproval(repo, sales, draft.id);
    expect(pending.approval_status).toBe("pending");
    await expect(approveDocument(repo, sales, draft.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(issueDocument(repo, sales, draft.id, deps)).rejects.toMatchObject({ code: "conflict" });

    const approved = await approveDocument(repo, { role: "accountant" }, draft.id);
    expect(approved.approval_status).toBe("approved");

    // Editing approved content clears the approval.
    const edited = await saveDraft(repo, sales, parseInput({ customerId: customer.id, reference: "PO-9" }, vat.id), draft.id);
    expect(edited.approval_status).toBe("none");
    expect(edited.reference).toBe("PO-9");

    await submitForApproval(repo, sales, draft.id);
    await approveDocument(repo, admin, draft.id);
    const issued = await issueDocument(repo, sales, draft.id, deps);
    expect(issued.document.status).toBe("issued");
  });

  it("reject requires a reason and only applies to pending documents", async () => {
    const { repo, customer, vat } = await setup();
    await repo.organization.updateSettings({ require_approval: true });
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
    await expect(rejectDocument(repo, admin, draft.id, "no")).rejects.toMatchObject({ code: "conflict" });
    await submitForApproval(repo, admin, draft.id);
    await expect(rejectDocument(repo, admin, draft.id, " ")).rejects.toMatchObject({ code: "invalid" });
    const rejected = await rejectDocument(repo, admin, draft.id, "Wrong price");
    expect(rejected.approval_status).toBe("rejected");
  });
});

describe("rbac in the service layer", () => {
  it("viewers cannot create, issue or duplicate", async () => {
    const { repo, customer, vat } = await setup();
    const viewer = { role: "viewer" } as const;
    await expect(saveDraft(repo, viewer, parseInput({ customerId: customer.id }, vat.id))).rejects.toMatchObject({ code: "forbidden" });

    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
    await expect(issueDocument(repo, viewer, draft.id, deps)).rejects.toMatchObject({ code: "forbidden" });
    await expect(duplicateDocument(repo, viewer, draft.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});
