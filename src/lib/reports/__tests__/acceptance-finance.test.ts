import { beforeAll, describe, expect, it } from "vitest";
import { createCreditNote } from "@/lib/credit-notes/credit-note-service";
import { buildDashboard } from "@/lib/dashboard/build-dashboard";
import { makeRepository, parseInput, seedCustomer, standardVat } from "@/lib/documents/__tests__/fixtures";
import { saveDraft } from "@/lib/documents/draft-service";
import { issueDocument, type IssueDependencies } from "@/lib/documents/issue-service";
import { createPublicLink, revokePublicLink, summarizeLink } from "@/lib/documents/link-service";
import { respondToProforma, voidDocument } from "@/lib/documents/void-service";
import { sendDocumentEmail } from "@/lib/email/send-document";
import type { EmailProvider } from "@/lib/email";
import { recordPayment } from "@/lib/payments/payment-service";
import { agingBucket, daysOverdue } from "@/lib/payments/aging";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { renderCustomerStatementPdf } from "@/lib/statements/render-statement";
import { loadCustomerStatement } from "@/lib/statements/statement-service";
import { addDaysISO, todayISO } from "@/lib/utils/date-math";
import { hashDocumentToken } from "@/lib/auth/document-token";
import { buildReport, loadReportDataset, runReport } from "../run-report";
import { reportToCsv, reportToXlsx, safeText } from "../export";
import { resolveDateRange } from "../date-range";
import { REPORT_IDS } from "../types";

const admin = { role: "admin" } as const;
const accountant = { role: "accountant" } as const;
const deps: IssueDependencies = { renderPdf: renderRepositoryDocumentPdf };
const everything = { from: "2000-01-01", to: "2999-12-31" };

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

async function scenario() {
  const { repo, store } = makeRepository();
  const customer = await seedCustomer(repo);
  const vat = await standardVat(repo);
  const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
  const invoice = (await issueDocument(repo, admin, draft.id, deps)).document;
  const pay = (amount: number) =>
    recordPayment(repo, accountant, {
      customerId: customer.id,
      paymentDate: todayISO(),
      amount,
      currency: "XAF",
      method: "bank_transfer",
      reference: "TRF-001",
      allocations: [{ documentId: invoice.id, amount }],
    });
  return { repo, store, customer, vat, invoice, pay };
}

describe("acceptance: issue -> partial payment -> remainder -> credit note -> dashboard / VAT / statement / history", () => {
  it("1. partial payment then remainder settles the invoice; 6. history is recorded", async () => {
    const { repo, invoice, pay } = await scenario();
    const part = await pay(400_000);
    expect(part.documents[0]).toMatchObject({ balance_due: 792_500, status: "partially_paid" });
    const rest = await pay(792_500);
    expect(rest.documents[0]).toMatchObject({ balance_due: 0, status: "paid" });

    const history = await repo.audit.list({ entityIds: [invoice.id] });
    const actions = history.map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(["document.issue", "payment.allocate"]));
  });

  it("2. a credit note on another invoice leaves the original intact; 3. dashboard shows the transactions", async () => {
    const { repo, customer, vat, invoice, pay } = await scenario();
    await pay(400_000);
    const second = await issueDocument(
      repo,
      admin,
      (await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id))).id,
      deps,
    );
    const credit = await createCreditNote(repo, admin, { invoiceId: second.document.id, mode: "full", reason: "Order cancelled" }, deps);
    expect(credit.invoice.number).toBe(second.document.number);

    const today = todayISO();
    const dashboard = buildDashboard(await loadReportDataset(repo, { id: "sales-summary", range: everything }), resolveDateRange("this_month", today));

    // Invoiced: 2 invoices of 1,192,500 less the 1,192,500 credit note = 1,192,500 net.
    expect(dashboard.invoiced.ttc).toBe(1_192_500);
    expect(dashboard.paid.amount).toBe(400_000);
    expect(dashboard.outstanding.amount).toBe(792_500);
    expect(dashboard.overdue.amount).toBe(0);
    expect(dashboard.recentPayments[0]).toMatchObject({ amount: 400_000 });
    expect(dashboard.recentInvoices.map((i) => i.number)).toContain(invoice.number);
    expect(dashboard.topCustomers[0]).toMatchObject({ name: "Acme Cameroon SARL", invoiced: 1_192_500 });
    expect(dashboard.monthly.at(-1)).toMatchObject({ sales: 1_000_000, paid: 400_000 }) // sales chart is excluding VAT;
  });

  it("4. the VAT summary shows the VAT collected and carries the not-an-official-return label", async () => {
    const { repo, pay } = await scenario();
    await pay(1_192_500);
    const report = await runReport(repo, { id: "vat-summary", range: everything });
    const vatCol = report.rows.reduce((s, r) => s + (typeof r.vat === "number" ? r.vat : 0), 0);
    expect(vatCol).toBe(192_500);
    expect(report.notes.join(" ")).toMatch(/not an official|DGI/i);
    expect(reportToCsv(report)).toContain("192500");
  });

  it("5. the customer statement is correct and the PDF generates on the letterhead", async () => {
    const { repo, customer, invoice, pay } = await scenario();
    await pay(500_000);
    const range = { from: addDaysISO(todayISO(), -30), to: todayISO() };
    const { statement } = await loadCustomerStatement(repo, customer.id, range);
    expect(statement.openingBalance).toBe(0);
    expect(statement.totalDebit).toBe(1_192_500);
    expect(statement.totalCredit).toBe(500_000);
    expect(statement.closingBalance).toBe(692_500);
    expect(statement.entries.map((e) => e.type)).toEqual(["invoice", "payment"]);
    expect(statement.entries[0]!.reference).toBe(invoice.number);
    expect(statement.entries.at(-1)!.balance).toBe(692_500);

    const pdf = await renderCustomerStatementPdf(repo, customer.id, range);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.filename).toMatch(/^statement-Acme-Cameroon-SARL-.*\.pdf$/);

    // Earlier period: invoices after `to` are ignored, opening balance carries the earlier activity.
    const later = await loadCustomerStatement(repo, customer.id, { from: addDaysISO(todayISO(), 1), to: addDaysISO(todayISO(), 10) });
    expect(later.statement.openingBalance).toBe(692_500);
    expect(later.statement.entries).toHaveLength(0);
    expect(later.statement.closingBalance).toBe(692_500);
  });
});

describe("reports", () => {
  it("every report builds, exports to CSV (with BOM) and to a valid XLSX workbook", async () => {
    const { repo, customer, pay } = await scenario();
    await pay(100_000);
    for (const id of REPORT_IDS) {
      const report = await runReport(repo, { id, range: everything, customerId: customer.id });
      const csv = reportToCsv(report);
      expect(csv.startsWith("\uFEFF"), id).toBe(true);
      const xlsx = reportToXlsx(report);
      expect(Buffer.from(xlsx.slice(0, 2)).toString(), id).toBe("PK");
    }
  });

  it("CSV cells cannot start a spreadsheet formula", () => {
    expect(safeText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeText("+1")).toBe("'+1");
    expect(safeText("Normal")).toBe("Normal");
  });

  it("outstanding receivables and aging use the net balance and the buckets 1-30 / 31-60 / 61-90 / 90+", async () => {
    const today = "2026-10-02";
    expect(daysOverdue("2026-10-01", today)).toBe(1);
    expect(agingBucket("2026-10-03", today)).toBe("current");
    expect(agingBucket("2026-09-02", today)).toBe("d1_30");
    expect(agingBucket("2026-09-01", today)).toBe("d31_60");
    expect(agingBucket("2026-07-31", today)).toBe("d61_90");
    expect(agingBucket("2026-06-01", today)).toBe("d90_plus");

    const { repo, pay } = await scenario();
    await pay(192_500);
    const report = await runReport(repo, { id: "outstanding-receivables", range: everything });
    expect(report.rows.reduce((s, r) => s + (typeof r.balance === "number" ? r.balance : 0), 0)).toBe(1_000_000);
  });

  it("the invoice number audit flags a gap and explains cancelled numbers", async () => {
    const { repo, customer, vat } = await scenario();
    const issue = async () =>
      (await issueDocument(repo, admin, (await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id))).id, deps)).document;
    const second = await issue();
    await issue();
    await voidDocument(repo, admin, second.id, "Issued to the wrong entity", deps);

    const complete = await loadReportDataset(repo, { id: "invoice-number-audit", range: everything });
    const clean = buildReport(complete, { id: "invoice-number-audit", range: everything });
    expect(clean.rows.filter((r) => r.finding === "GAP")).toHaveLength(0);
    const cancelled = clean.rows.find((r) => r.finding === "Cancelled");
    expect(cancelled).toMatchObject({ number: second.number, explanation: expect.stringContaining("wrong entity") });

    // Remove a number from the dataset: the audit must report the missing one.
    const withoutSecond = { ...complete, documents: complete.documents.filter((d) => d.id !== second.id) };
    const gapped = buildReport(withoutSecond, { id: "invoice-number-audit", range: everything });
    const gap = gapped.rows.find((r) => r.finding === "GAP");
    expect(gap?.number).toBe(second.number);
  });
});

describe("proforma responses", () => {
  it("accept / decline / expire keep the number; a converted or draft proforma cannot be answered", async () => {
    const { repo, customer, vat } = await scenario();
    const make = async () =>
      (await issueDocument(repo, admin, (await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id))).id, deps)).document;
    const a = await make();
    const accepted = await respondToProforma(repo, admin, a.id, "accept", "Verbal OK");
    expect(accepted).toMatchObject({ status: "accepted", number: a.number });
    await expect(respondToProforma(repo, admin, a.id, "decline")).rejects.toThrow(/already/);

    const b = await make();
    expect((await respondToProforma(repo, admin, b.id, "decline")).status).toBe("rejected");
    const c = await make();
    expect((await respondToProforma(repo, admin, c.id, "expire")).status).toBe("expired");

    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id }, vat.id));
    await expect(respondToProforma(repo, admin, draft.id, "accept")).rejects.toThrow(/Issue the proforma/);
  });
});

describe("secure public links", () => {
  const env = { secret: "x".repeat(40), baseUrl: "https://example.test/" };

  it("shows the token once, stores only its HMAC, replaces on re-create and revokes", async () => {
    const { repo, invoice } = await scenario();
    const first = await createPublicLink(repo, admin, invoice.id, env, { expiresInDays: 30 });
    expect(first.url).toBe(`https://example.test/document/${first.token}`);

    const stored = (await repo.documents.get(invoice.id))!.document;
    expect(stored.public_token_hash).toBe(hashDocumentToken(first.token, env.secret));
    expect(JSON.stringify(stored)).not.toContain(first.token);
    expect(summarizeLink(stored).status).toBe("valid");
    expect((await repo.documents.findByTokenHash(stored.public_token_hash!))?.id).toBe(invoice.id);

    const second = await createPublicLink(repo, admin, invoice.id, env);
    expect(second.token).not.toBe(first.token);
    expect(await repo.documents.findByTokenHash(hashDocumentToken(first.token, env.secret))).toBeNull();

    await revokePublicLink(repo, admin, invoice.id);
    expect(summarizeLink((await repo.documents.get(invoice.id))!.document).status).toBe("revoked");
    await expect(createPublicLink(repo, admin, invoice.id, env, { expiresInDays: 0 })).rejects.toThrow(/between 1 and 730/);
  });

  it("refuses drafts and roles without send permission", async () => {
    const { repo, customer, vat } = await scenario();
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
    await expect(createPublicLink(repo, admin, draft.id, env)).rejects.toThrow(/Issue the document/);
    await expect(createPublicLink(repo, { role: "viewer" }, draft.id, env)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("email", () => {
  const link = { secret: "y".repeat(40), baseUrl: "https://example.test" };
  const sent: Array<Parameters<EmailProvider["send"]>[0]> = [];
  const provider = (result: Awaited<ReturnType<EmailProvider["send"]>>): EmailProvider => ({
    name: "test",
    send: async (m) => {
      sent.push(m);
      return result;
    },
  });
  const emailDeps = (p: EmailProvider) => ({ provider: p, renderPdf: renderRepositoryDocumentPdf, link });

  it("attaches the PDF, logs the send and marks the document SENT only when really delivered", async () => {
    const { repo, invoice } = await scenario();
    const out = await sendDocumentEmail(repo, accountant, { documentId: invoice.id, to: ["client@acme.test"] }, emailDeps(provider({ ok: true, provider: "test", status: "sent", messageId: "m1" })));
    expect(out.delivered).toBe(true);
    expect(sent.at(-1)!.attachments![0]).toMatchObject({ filename: `${invoice.number}.pdf`, contentType: "application/pdf" });
    expect(out.log).toMatchObject({ status: "sent", provider: "test", to_emails: ["client@acme.test"] });
    expect((await repo.documents.get(invoice.id))!.document.status).toBe("sent");
    expect(await repo.emailLogs.listForDocument(invoice.id)).toHaveLength(1);
  });

  it("a demo-outbox 'queued' result is logged as queued and never claims delivery", async () => {
    const { repo, invoice } = await scenario();
    const out = await sendDocumentEmail(repo, accountant, { documentId: invoice.id, to: ["client@acme.test"], includeLink: true }, emailDeps(provider({ ok: true, provider: "demo-outbox", status: "queued" })));
    expect(out.delivered).toBe(false);
    expect(out.log.status).toBe("queued");
    expect(out.linkUrl).toMatch(/^https:\/\/example\.test\/document\//);
    const doc = (await repo.documents.get(invoice.id))!.document;
    expect(doc.status).toBe("issued");
    expect(doc.sent_at).toBeNull();
  });

  it("a provider failure is logged as failed and reported", async () => {
    const { repo, invoice } = await scenario();
    await expect(
      sendDocumentEmail(repo, accountant, { documentId: invoice.id, to: ["client@acme.test"] }, emailDeps(provider({ ok: false, provider: "none", error: "Email delivery is not configured." }))),
    ).rejects.toThrow(/not configured/);
    const logs = await repo.emailLogs.listForDocument(invoice.id);
    expect(logs[0]).toMatchObject({ status: "failed", error_message: "Email delivery is not configured." });
  });

  it("refuses drafts, cancelled documents and invalid addresses", async () => {
    const { repo, customer, vat, invoice } = await scenario();
    const ok = emailDeps(provider({ ok: true, provider: "test", status: "sent" }));
    await expect(sendDocumentEmail(repo, accountant, { documentId: invoice.id, to: ["nope"] }, ok)).rejects.toThrow(/valid email/);
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType: "invoice" }, vat.id));
    await expect(sendDocumentEmail(repo, accountant, { documentId: draft.id, to: ["a@b.co"] }, ok)).rejects.toThrow(/Issue the document/);
    await voidDocument(repo, admin, invoice.id, "Wrong customer", deps);
    await expect(sendDocumentEmail(repo, accountant, { documentId: invoice.id, to: ["a@b.co"] }, ok)).rejects.toThrow(/cancelled/);
  });
});

describe("date ranges", () => {
  it("resolves the dashboard presets", () => {
    expect(resolveDateRange("this_month", "2026-10-02")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveDateRange("last_month", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveDateRange("quarter", "2026-11-20")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveDateRange("year", "2026-10-02")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(resolveDateRange("custom", "2026-10-02", { from: "2026-02-01", to: "2026-02-28" })).toMatchObject({ preset: "custom", from: "2026-02-01", to: "2026-02-28" });
    expect(resolveDateRange("custom", "2026-10-02", { from: "2026-03-01", to: "2026-02-01" }).from).toBe("2026-10-01");
  });
});
