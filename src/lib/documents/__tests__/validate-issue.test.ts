import { describe, expect, it } from "vitest";
import { saveDraft } from "../draft-service";
import { validateDocumentForIssue, type IssueCheckInput } from "../validate-issue";
import { makeRepository, parseInput, seedCustomer, standardVat } from "./fixtures";

const admin = { role: "admin" } as const;

async function draftCheckInput(overrides: { customer?: Parameters<typeof seedCustomer>[1]; requireApproval?: boolean } = {}) {
  const { repo } = makeRepository();
  const customer = await seedCustomer(repo, overrides.customer);
  const vat = await standardVat(repo);
  const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
  if (overrides.requireApproval !== undefined) {
    await repo.organization.updateSettings({ require_approval: overrides.requireApproval });
  }
  const bundle = await repo.documents.get(draft.id);
  if (!bundle) throw new Error("draft vanished");
  const [organization, settings, destinations] = await Promise.all([
    repo.organization.get(),
    repo.organization.getSettings(),
    repo.paymentDestinations.list(),
  ]);
  const input: IssueCheckInput = {
    document: bundle.document,
    items: bundle.items,
    withholdings: bundle.withholdings,
    customer: bundle.customer,
    organization,
    settings,
    destinations,
  };
  return { repo, input };
}

const codes = (list: ReadonlyArray<{ code: string }>) => list.map((i) => i.code);

describe("validateDocumentForIssue", () => {
  it("accepts a well-formed draft (acceptance line)", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue(input);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("only warns (never blocks) when a company customer has no NIU", async () => {
    const { input } = await draftCheckInput({ customer: { niu: null } });
    const result = validateDocumentForIssue(input);
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain("customer_niu_missing");
  });

  it("does not warn about NIU for an individual", async () => {
    const { input } = await draftCheckInput({ customer: { customer_type: "individual", niu: null } });
    expect(codes(validateDocumentForIssue(input).warnings)).not.toContain("customer_niu_missing");
  });

  it("blocks documents without lines", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue({ ...input, items: [] });
    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain("no_lines");
  });

  it("blocks an inactive or missing customer", async () => {
    const { input } = await draftCheckInput();
    const inactive = validateDocumentForIssue({ ...input, customer: { ...input.customer!, is_active: false } });
    expect(codes(inactive.errors)).toContain("customer_inactive");
    const missing = validateDocumentForIssue({ ...input, customer: null });
    expect(codes(missing.errors)).toContain("customer_missing");
  });

  it("blocks documents that are not drafts", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue({ ...input, document: { ...input.document, status: "issued" } });
    expect(codes(result.errors)).toContain("not_draft");
  });

  it("blocks lines with a blank description, zero quantity or negative price", async () => {
    const { input } = await draftCheckInput();
    const [line] = input.items;
    const bad = validateDocumentForIssue({
      ...input,
      items: [
        { ...line, description: "  " },
        { ...line, id: "b", position: 2, quantity: 0 },
        { ...line, id: "c", position: 3, unit_price: -5 },
      ],
    });
    expect(codes(bad.errors)).toEqual(expect.arrayContaining(["line_description", "line_quantity", "line_price"]));
    expect(bad.errors.find((e) => e.code === "line_quantity")?.line).toBe(2);
  });

  it("blocks stored totals that no longer match the lines (tampering / stale draft)", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue({ ...input, document: { ...input.document, total_ttc: 1 } });
    expect(codes(result.errors)).toContain("totals_out_of_sync");
  });

  it("blocks a due date before the issue date", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue({
      ...input,
      document: { ...input.document, issue_date: "2026-05-10", due_date: "2026-05-01" },
    });
    expect(codes(result.errors)).toContain("due_before_issue");
  });

  it("requires approval only when the organization asks for it", async () => {
    const needs = await draftCheckInput({ requireApproval: true });
    expect(codes(validateDocumentForIssue(needs.input).errors)).toContain("approval_required");

    const approved = validateDocumentForIssue({
      ...needs.input,
      document: { ...needs.input.document, approval_status: "approved" },
    });
    expect(codes(approved.errors)).not.toContain("approval_required");

    const off = await draftCheckInput({ requireApproval: false });
    expect(codes(validateDocumentForIssue(off.input).errors)).not.toContain("approval_required");
  });

  it("blocks when the issuer legal name is missing", async () => {
    const { input } = await draftCheckInput();
    const result = validateDocumentForIssue({ ...input, organization: { ...input.organization!, legal_name: " " } });
    expect(codes(result.errors)).toContain("issuer_missing");
  });
});
