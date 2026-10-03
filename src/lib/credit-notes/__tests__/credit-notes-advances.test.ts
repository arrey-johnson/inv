import { beforeAll, describe, expect, it } from "vitest";
import { applyAdvanceToInvoice, listAvailableAdvances, splitAdvanceAmount } from "@/lib/advances/advance-service";
import { makeRepository, parseInput, seedCustomer, standardVat } from "@/lib/documents/__tests__/fixtures";
import { computeBuilderTotals, emptyLine } from "@/lib/documents/builder-model";
import { saveDraft } from "@/lib/documents/draft-service";
import { issueDocument, type IssueDependencies } from "@/lib/documents/issue-service";
import { voidDocument } from "@/lib/documents/void-service";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { recordPayment } from "@/lib/payments/payment-service";
import { todayISO } from "@/lib/utils/date-math";
import { createCreditNote } from "../credit-note-service";

const admin = { role: "admin" } as const;
const accountant = { role: "accountant" } as const;
const deps: IssueDependencies = { renderPdf: renderRepositoryDocumentPdf };

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

async function world() {
  const { repo, store } = makeRepository();
  const customer = await seedCustomer(repo);
  const vat = await standardVat(repo);
  const issue = async (raw: Partial<Parameters<typeof parseInput>[0]> = {}) => {
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice", ...raw }, vat.id));
    return (await issueDocument(repo, admin, draft.id, deps)).document;
  };
  const pay = (documentId: string, amount: number) =>
    recordPayment(repo, accountant, {
      customerId: customer.id,
      paymentDate: todayISO(),
      amount,
      currency: "XAF",
      method: "bank_transfer",
      allocations: [{ documentId, amount }],
    });
  return { repo, store, customer, vat, issue, pay };
}

const twoLines = (taxRateId: string) => [
  { description: "Design", quantity: "4", unitPrice: "100000", discountType: "none" as const, discountValue: "0", taxRateId },
  { description: "Hosting", quantity: "1", unitPrice: "600000", discountType: "none" as const, discountValue: "0", taxRateId },
];

describe("credit notes", () => {
  it("a full credit note reverses HT and VAT, references the invoice, and leaves the original untouched", async () => {
    const { repo, issue } = await world();
    const invoice = await issue();
    const snapshotBefore = await repo.documents.get(invoice.id);

    const out = await createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "full", reason: "Order cancelled by customer" }, deps);

    expect(out.creditNote.document_type).toBe("credit_note");
    expect(out.creditNote.number).toMatch(/^PS-CN-\d{4}-0001$/);
    expect(out.creditNote).toMatchObject({ net_ht: 1_000_000, tax_total: 192_500, total_ttc: 1_192_500, status: "issued" });

    // The invoice is credited in full: balance 0, status credited, number/lines/amounts unchanged.
    expect(out.invoice).toMatchObject({ status: "credited", balance_due: 0, number: invoice.number, total_ttc: 1_192_500 });
    const after = await repo.documents.get(invoice.id);
    expect(after!.items).toEqual(snapshotBefore!.items);
    expect(after!.document.net_ht).toBe(invoice.net_ht);
    expect(after!.document.pdf_sha256).toBe(invoice.pdf_sha256);

    const links = await repo.documents.linksFor(invoice.id);
    expect(links.some((l) => l.link_type === "credit_for")).toBe(true);
    const audit = await repo.audit.list({ entityIds: [invoice.id, out.creditNote.id] });
    expect(audit.map((a) => a.action)).toContain("credit_note.create");
  });

  it("a partial credit note by amount reduces the balance proportionally and the invoice stays open", async () => {
    const { repo, issue, vat } = await world();
    const invoice = await issue();
    const out = await createCreditNote(
      repo,
      admin,
      { invoiceId: invoice.id, mode: "amount", amountHt: 100_000, taxRateId: vat.id, reason: "Goodwill gesture" },
      deps,
    );
    expect(out.creditNote).toMatchObject({ net_ht: 100_000, tax_total: 19_250, total_ttc: 119_250 });
    expect(out.invoice.balance_due).toBe(1_073_250);
    expect(out.invoice.status).toBe("issued");
  });

  it("a line credit note credits only part of a line's quantity and tracks what is left", async () => {
    const { repo, issue, vat } = await world();
    const invoice = await issue({ lines: twoLines(vat.id) });
    const bundle = (await repo.documents.get(invoice.id))!;
    const design = bundle.items.find((i) => i.description === "Design")!;

    const first = await createCreditNote(
      repo,
      admin,
      { invoiceId: invoice.id, mode: "lines", lines: [{ sourceItemId: design.id, quantity: 1 }], reason: "One design day not delivered" },
      deps,
    );
    expect(first.creditNote).toMatchObject({ net_ht: 100_000, tax_total: 19_250, total_ttc: 119_250 });

    // 4 ordered, 1 credited: 3 left. Crediting 4 more is refused.
    await expect(
      createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "lines", lines: [{ sourceItemId: design.id, quantity: 4 }], reason: "Too many on purpose" }, deps),
    ).rejects.toThrow();
    const second = await createCreditNote(
      repo,
      admin,
      { invoiceId: invoice.id, mode: "lines", lines: [{ sourceItemId: design.id, quantity: 3 }], reason: "Remaining design days" },
      deps,
    );
    expect(second.creditNote.net_ht).toBe(300_000);
  });

  it("refuses more than the invoice total, a draft, a proforma, and a second full credit", async () => {
    const { repo, issue, vat, customer } = await world();
    const invoice = await issue();
    await expect(
      createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "amount", amountHt: 2_000_000, taxRateId: vat.id, reason: "Far too much" }, deps),
    ).rejects.toThrow(/more than what can still be credited/);

    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
    await expect(createCreditNote(repo, admin, { invoiceId: draft.id, mode: "full", reason: "Nothing to credit" }, deps)).rejects.toThrow(/draft/);

    await createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "full", reason: "Order cancelled by customer" }, deps);
    await expect(createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "full", reason: "Second try" }, deps)).rejects.toThrow(/already been credited/);
  });

  it("crediting a partly paid invoice never gives a negative balance; voiding the credit note releases it", async () => {
    const { repo, issue, pay } = await world();
    const invoice = await issue();
    await pay(invoice.id, 500_000);
    const out = await createCreditNote(repo, admin, { invoiceId: invoice.id, mode: "full", reason: "Customer cancelled" }, deps);
    // Nothing is left to collect (the 500,000 already received is a refund/credit matter, not modelled).
    expect(out.invoice.balance_due).toBe(0);
    expect(out.invoice.paid_amount).toBe(500_000);

    const voided = await voidDocument(repo, admin, out.creditNote.id, "Credit note raised in error", deps);
    expect(voided.document.status).toBe("void");
    expect(voided.document.number).toBe(out.creditNote.number);
    const restored = (await repo.documents.get(invoice.id))!.document;
    expect(restored.balance_due).toBe(692_500);
    expect(restored.status).toBe("partially_paid");
  });

  it("issued invoices are never deleted", async () => {
    const { repo, issue } = await world();
    const invoice = await issue();
    const { deleteDraft } = await import("@/lib/documents/draft-service");
    await expect(deleteDraft(repo, admin, invoice.id)).rejects.toMatchObject({ code: "immutable" });
  });
});

describe("advance (deposit) invoices", () => {
  it("splits VAT proportionally and the last deduction takes the remaining VAT (no cents lost)", () => {
    const base = { currency: "XAF" as const, advanceTotalTTC: 1_000, advanceTaxTotal: 161.34 };
    const a = splitAdvanceAmount({ ...base, amount: 333, previous: [] });
    const b = splitAdvanceAmount({ ...base, amount: 333, previous: [{ amount: 333, vatAmount: a.vatAmount }] });
    const c = splitAdvanceAmount({
      ...base,
      amount: 334,
      previous: [
        { amount: 333, vatAmount: a.vatAmount },
        { amount: 333, vatAmount: b.vatAmount },
      ],
    });
    expect(a.htAmount + a.vatAmount).toBe(333);
    expect(c.htAmount + c.vatAmount).toBe(334);
    expect(a.vatAmount + b.vatAmount + c.vatAmount).toBe(161);
  });

  it("an advance must be PAID before it can be deducted; then VAT is not duplicated on the final invoice", async () => {
    const { repo, issue, pay, customer, vat } = await world();
    const advance = await issue({
      documentType: "advance",
      lines: [{ description: "Deposit 30%", quantity: "1", unitPrice: "600000", discountType: "none", discountValue: "0", taxRateId: vat.id }],
    });
    expect(advance.document_type).toBe("advance");
    expect(advance.number).toMatch(/^PS-ADV-\d{4}-0001$/);
    expect(advance.total_ttc).toBe(715_500); // 600,000 + 115,500 VAT

    const final = await issue({ lines: [{ description: "Project", quantity: "1", unitPrice: "2000000", discountType: "none", discountValue: "0", taxRateId: vat.id }] });
    expect(final.total_ttc).toBe(2_385_000);

    await expect(applyAdvanceToInvoice(repo, admin, { advanceId: advance.id, invoiceId: final.id })).rejects.toThrow(/paid/i);

    await pay(advance.id, 715_500);
    const available = await listAvailableAdvances(repo, customer.id, "XAF");
    expect(available.map((a) => [a.advance.id, a.remaining])).toEqual([[advance.id, 715_500]]);

    const applied = await applyAdvanceToInvoice(repo, admin, { advanceId: advance.id, invoiceId: final.id });
    expect(applied).toMatchObject({ applied: 715_500, htAmount: 600_000, vatAmount: 115_500 });
    // The final invoice still shows its full TTC; only the amount still to pay drops.
    expect(applied.invoice.total_ttc).toBe(2_385_000);
    expect(applied.invoice.tax_total).toBe(385_000);
    expect(applied.invoice.balance_due).toBe(1_669_500);

    // Cannot deduct the same advance twice.
    await expect(applyAdvanceToInvoice(repo, admin, { advanceId: advance.id, invoiceId: final.id })).rejects.toThrow();

    // VAT summary: advance VAT (115,500) + invoice VAT (385,000) - VAT already declared on the advance (115,500).
    const { runReport } = await import("@/lib/reports/run-report");
    const vatReport = await runReport(repo, { id: "vat-summary", range: { from: "2000-01-01", to: "2999-12-31" } });
    const vatSum = vatReport.rows.reduce((s, r) => s + (typeof r.vat === "number" ? r.vat : 0), 0);
    expect(vatSum).toBe(385_000); // 500,500 declared in total - 115,500 already declared on the advance
  });
});

describe("withholding display math", () => {
  const vatRate = { id: "vat", name: "VAT", rate: 19.25, category: "vat", is_active: true } as const;

  it("withholding reduces the net cash payable, never the commercial total TTC", () => {
    const totals = computeBuilderTotals(
      {
        currency: "XAF",
        lines: [{ ...emptyLine("vat"), description: "Website", unitPrice: "1000000" }],
        globalDiscountType: "none",
        globalDiscountValue: "0",
        withholdingTypeIds: ["w5"],
      },
      [vatRate],
      true,
      [{ id: "w5", code: "AIR5", name: "Test withholding", rate: 5, base: "net_ht", is_active: true }],
    );
    expect(totals.calc?.totalTTC).toBe(1_192_500);
    expect(totals.calc?.withholdingTotal).toBe(50_000);
    expect(totals.calc?.netPayable).toBe(1_142_500);
  });

  it("works end to end: stored on the invoice, balance = net payable, paying it settles the invoice", async () => {
    const { repo, customer, vat, pay } = await world();
    const w = await repo.taxes.createWithholding({ code: "AIR5", name: "Test withholding", rate: 5, base: "net_ht", description: null, is_active: true });
    const draft = await saveDraft(
      repo,
      admin,
      parseInput({ customerId: customer.id, documentType: "invoice", withholdingTypeIds: [w.id] }, vat.id),
    );
    expect(draft).toMatchObject({ total_ttc: 1_192_500, withholding_total: 50_000, net_payable: 1_142_500 });
    const invoice = (await issueDocument(repo, admin, draft.id, deps)).document;
    expect(invoice.balance_due).toBe(1_142_500);

    await expect(pay(invoice.id, 1_192_500)).rejects.toThrow(/Overpayment/);
    const paid = await pay(invoice.id, 1_142_500);
    expect(paid.documents[0]).toMatchObject({ status: "paid", balance_due: 0 });
  });

  it("withholding is rejected when it would exceed the total", () => {
    const totals = computeBuilderTotals(
      {
        currency: "XAF",
        lines: [{ ...emptyLine("vat"), description: "Website", unitPrice: "1000" }],
        globalDiscountType: "none",
        globalDiscountValue: "0",
        withholdingTypeIds: ["w"],
      },
      [vatRate],
      true,
      [{ id: "w", code: "BIG", name: "Big", rate: 500, base: "net_ht", is_active: true }],
    );
    expect(totals.calc === null || totals.error !== null || totals.calc.netPayable >= 0).toBe(true);
  });
});
