import { beforeAll, describe, expect, it } from "vitest";
import { makeRepository, parseInput, seedCustomer, standardVat } from "@/lib/documents/__tests__/fixtures";
import { saveDraft } from "@/lib/documents/draft-service";
import { issueDocument, type IssueDependencies } from "@/lib/documents/issue-service";
import { voidDocument } from "@/lib/documents/void-service";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { addDaysISO, todayISO } from "@/lib/utils/date-math";
import { recordPayment, refreshOverdue, voidPayment } from "../payment-service";

const admin = { role: "admin" } as const;
const accountant = { role: "accountant" } as const;
const sales = { role: "sales" } as const;
const deps: IssueDependencies = { renderPdf: renderRepositoryDocumentPdf };

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

async function issuedInvoice(raw: Parameters<typeof parseInput>[0] extends infer R ? Partial<R> : never = {}) {
  const { repo, store } = makeRepository();
  const customer = await seedCustomer(repo);
  const vat = await standardVat(repo);
  const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice", ...raw }, vat.id));
  const issued = await issueDocument(repo, admin, draft.id, deps);
  return { repo, store, customer, vat, invoice: issued.document };
}

const pay = (repo: Awaited<ReturnType<typeof issuedInvoice>>["repo"], customerId: string, documentId: string, amount: number, extra: Record<string, unknown> = {}) =>
  recordPayment(repo, accountant, {
    customerId,
    paymentDate: todayISO(),
    amount,
    currency: "XAF",
    method: "bank_transfer",
    allocations: [{ documentId, amount }],
    ...extra,
  });

describe("payments", () => {
  it("partial payment, then the remainder -> PARTIALLY_PAID then PAID with correct balances", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    expect(invoice.total_ttc).toBe(1_192_500);
    expect(invoice.balance_due).toBe(1_192_500);

    const first = await pay(repo, customer.id, invoice.id, 500_000, { reference: "TRF-1", method: "mtn_momo" });
    expect(first.documents[0]).toMatchObject({ paid_amount: 500_000, balance_due: 692_500, status: "partially_paid" });

    const second = await pay(repo, customer.id, invoice.id, 692_500, { method: "orange_money" });
    expect(second.documents[0]).toMatchObject({ paid_amount: 1_192_500, balance_due: 0, status: "paid" });

    const history = await repo.payments.forDocument(invoice.id);
    expect(history.map((h) => h.payment.amount).sort((a, b) => a - b)).toEqual([500_000, 692_500]);
  });

  it("refuses overpayment with a clear message and changes nothing", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    await expect(pay(repo, customer.id, invoice.id, 1_192_501)).rejects.toThrow(/Overpayment/);
    await expect(pay(repo, customer.id, invoice.id, 1_192_501)).rejects.toThrow(/1,192,500/);
    const after = (await repo.documents.get(invoice.id))!.document;
    expect(after).toMatchObject({ paid_amount: 0, balance_due: 1_192_500, status: "issued" });
    expect((await repo.payments.listAll({})).length).toBe(0);
  });

  it("refuses payment above the REMAINING balance after a partial payment", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    await pay(repo, customer.id, invoice.id, 1_000_000);
    await expect(pay(repo, customer.id, invoice.id, 200_000)).rejects.toThrow(/Overpayment/);
  });

  it("never leaves unapplied money: the allocations must add up to the payment", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    await expect(
      recordPayment(repo, accountant, {
        customerId: customer.id,
        paymentDate: todayISO(),
        amount: 600_000,
        currency: "XAF",
        method: "cash",
        allocations: [{ documentId: invoice.id, amount: 500_000 }],
      }),
    ).rejects.toThrow(/not applied/);
  });

  it("refuses a future payment date, a draft invoice and a payment by a role without permission", async () => {
    const { repo, customer, invoice, vat } = await issuedInvoice();
    await expect(pay(repo, customer.id, invoice.id, 1000, { paymentDate: addDaysISO(todayISO(), 3) })).rejects.toThrow(/future/);

    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
    const refused = await pay(repo, customer.id, draft.id, 1000).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: "invalid" });
    const text = [(refused as Error).message, ...((refused as { details?: string[] }).details ?? [])].join(" ");
    expect(text).toMatch(/draft|issued|not.*open|cannot/i);

    await expect(
      recordPayment(repo, sales, {
        customerId: customer.id,
        paymentDate: todayISO(),
        amount: 1000,
        currency: "XAF",
        method: "cash",
        allocations: [{ documentId: invoice.id, amount: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("splits one payment across several invoices of the customer", async () => {
    const { repo, customer, invoice, vat } = await issuedInvoice();
    const second = await issueDocument(
      repo,
      admin,
      (await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id))).id,
      deps,
    );
    const result = await recordPayment(repo, accountant, {
      customerId: customer.id,
      paymentDate: todayISO(),
      amount: 2_000_000,
      currency: "XAF",
      method: "cheque",
      allocations: [
        { documentId: invoice.id, amount: 1_192_500 },
        { documentId: second.document.id, amount: 807_500 },
      ],
    });
    expect(result.documents.find((d) => d.id === invoice.id)?.status).toBe("paid");
    expect(result.documents.find((d) => d.id === second.document.id)).toMatchObject({ status: "partially_paid", balance_due: 385_000 });
  });

  it("an invoice is only PAID through a payment; an adjustment is admin-only, needs a reason and is flagged + audited", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    const adjustment = {
      customerId: customer.id,
      paymentDate: todayISO(),
      amount: invoice.balance_due,
      currency: "XAF",
      method: "other",
      isAdjustment: true,
      allocations: [{ documentId: invoice.id, amount: invoice.balance_due }],
    };
    await expect(recordPayment(repo, accountant, { ...adjustment, adjustmentReason: "Settled in kind by agreement" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordPayment(repo, admin, { ...adjustment, adjustmentReason: "short" })).rejects.toThrow(/Explain/);

    const done = await recordPayment(repo, admin, { ...adjustment, adjustmentReason: "Settled in kind by agreement 2026-10" });
    expect(done.payment).toMatchObject({ is_adjustment: true, adjustment_reason: "Settled in kind by agreement 2026-10" });
    expect(done.documents[0]!.status).toBe("paid");

    const audit = await repo.audit.list({ entityIds: [done.payment.id] });
    expect(audit.map((a) => a.action)).toContain("payment.adjust");
  });

  it("voiding a payment restores the balance and status", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    const paid = await pay(repo, customer.id, invoice.id, 1_192_500);
    expect(paid.documents[0]!.status).toBe("paid");
    await expect(voidPayment(repo, accountant, paid.payment.id, "no")).rejects.toThrow(/reason/);
    const voided = await voidPayment(repo, accountant, paid.payment.id, "Cheque bounced");
    expect(voided.documents[0]).toMatchObject({ paid_amount: 0, balance_due: 1_192_500, status: "issued" });
    expect((await repo.payments.get(paid.payment.id))!.payment.void_reason).toBe("Cheque bounced");
    await expect(voidPayment(repo, accountant, paid.payment.id, "again please")).rejects.toThrow(/already/);
  });

  it("stores a proof of payment (type and size checked)", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const ok = await recordPayment(
      repo,
      accountant,
      { customerId: customer.id, paymentDate: todayISO(), amount: 1000, currency: "XAF", method: "cash", allocations: [{ documentId: invoice.id, amount: 1000 }] },
      { fileName: "proof.pdf", mimeType: "application/pdf", bytes },
    );
    const stored = await repo.attachments.listFor("payment", ok.payment.id);
    expect(stored).toHaveLength(1);
    expect((await repo.attachments.read(stored[0]!.id))!.bytes).toEqual(bytes);

    await expect(
      recordPayment(
        repo,
        accountant,
        { customerId: customer.id, paymentDate: todayISO(), amount: 1000, currency: "XAF", method: "cash", allocations: [{ documentId: invoice.id, amount: 1000 }] },
        { fileName: "x.exe", mimeType: "application/x-msdownload", bytes },
      ),
    ).rejects.toThrow(/PDF, PNG, JPG or WEBP/);
    await expect(
      recordPayment(
        repo,
        accountant,
        { customerId: customer.id, paymentDate: todayISO(), amount: 1000, currency: "XAF", method: "cash", allocations: [{ documentId: invoice.id, amount: 1000 }] },
        { fileName: "big.png", mimeType: "image/png", bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
      ),
    ).rejects.toThrow(/too large/);
  });
});

describe("overdue", () => {
  const past = addDaysISO(todayISO(), -60);

  it("marks an invoice OVERDUE when due < today and a balance remains; also when partially paid", async () => {
    const { repo, customer, invoice } = await issuedInvoice({ issueDate: past, dueDate: addDaysISO(past, 30) });
    expect(invoice.status).toBe("issued");
    expect(await repo.documents.syncOverdue(todayISO())).toBe(1);
    expect((await repo.documents.get(invoice.id))!.document.status).toBe("overdue");

    const partial = await pay(repo, customer.id, invoice.id, 100_000, { paymentDate: past });
    expect(partial.documents[0]).toMatchObject({ status: "overdue", paid_amount: 100_000 });
  });

  it("does not overwrite PAID, VOID or fully credited invoices", async () => {
    const { repo, customer, invoice } = await issuedInvoice({ issueDate: past, dueDate: addDaysISO(past, 30) });
    await pay(repo, customer.id, invoice.id, invoice.balance_due, { paymentDate: past });
    await refreshOverdue(repo);
    expect((await repo.documents.get(invoice.id))!.document.status).toBe("paid");

    const second = await issuedInvoice({ issueDate: past, dueDate: addDaysISO(past, 30) });
    await voidDocument(second.repo, admin, second.invoice.id, "Issued by mistake", deps);
    await refreshOverdue(second.repo);
    expect((await second.repo.documents.get(second.invoice.id))!.document.status).toBe("void");
  });

  it("an invoice not yet due stays ISSUED", async () => {
    const { repo, invoice } = await issuedInvoice();
    await repo.documents.syncOverdue(todayISO());
    expect((await repo.documents.get(invoice.id))!.document.status).toBe("issued");
  });
});

describe("void / cancel", () => {
  it("keeps the number, records the reason and prints CANCELLED; refused while payments exist", async () => {
    const { repo, customer, invoice } = await issuedInvoice();
    const before = await renderRepositoryDocumentPdf(repo, invoice.id);

    await pay(repo, customer.id, invoice.id, 1000);
    await expect(voidDocument(repo, admin, invoice.id, "Wrong customer", deps)).rejects.toThrow(/Payments are recorded/);

    const payments = await repo.payments.forDocument(invoice.id);
    await voidPayment(repo, accountant, payments[0]!.payment.id, "Recorded in error");
    const result = await voidDocument(repo, admin, invoice.id, "Wrong customer", deps);
    expect(result.document).toMatchObject({ status: "void", number: invoice.number, void_reason: "Wrong customer", balance_due: 0 });
    expect(result.pdfError).toBeNull();

    const after = await renderRepositoryDocumentPdf(repo, invoice.id);
    expect(after.filename).toBe(before.filename);
    expect(Buffer.from(after.bytes).equals(Buffer.from(before.bytes))).toBe(false);

    await expect(voidDocument(repo, admin, invoice.id, "again please", deps)).rejects.toThrow(/already cancelled/);
    await expect(voidDocument(repo, sales, invoice.id, "not allowed here", deps)).rejects.toMatchObject({ code: "forbidden" });
  });
});
