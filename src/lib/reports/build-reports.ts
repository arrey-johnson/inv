import { daysOverdue, agingBucket, AGING_BUCKETS, AGING_LABELS, type AgingBucket } from "@/lib/payments/aging";
import { D, ZERO, roundMoney, sumDecimals, type CurrencyCode, type Dec } from "@/lib/finance/money";
import { buildCustomerStatement } from "@/lib/statements/build-statement";
import { monthsInRange, inRange } from "./date-range";
import { REPORT_META, type Report, type ReportColumn, type ReportDataset, type ReportId, type ReportRow } from "./types";

export const VAT_DISCLAIMER =
  "Accounting aid only. This is NOT an official DGI (Direction Generale des Impots) VAT return and is not filed with the tax administration. " +
  "Check every figure with your accountant before declaring.";

type Doc = ReportDataset["documents"][number];
type Range = { from: string; to: string };

const num = (d: Dec | number, currency: CurrencyCode) => roundMoney(d, currency).toNumber();
const issued = (d: Doc) => d.status !== "draft" && d.number !== null;
const counted = (d: Doc) => issued(d) && d.status !== "void";
const isReceivable = (d: Doc) => d.document_type === "invoice" || d.document_type === "advance";

function base(ds: ReportDataset, id: ReportId, period: Range | null, columns: ReportColumn[], rows: ReportRow[], notes: string[] = []): Report {
  return {
    id,
    title: REPORT_META[id].title,
    description: REPORT_META[id].description,
    currency: ds.currency,
    period,
    columns,
    rows,
    totals: null,
    notes,
  };
}

/** Sum the given numeric columns into a totals row. */
function withTotals(report: Report, keys: string[], label?: { key: string; text: string }): Report {
  const totals: ReportRow = {};
  for (const key of keys) {
    totals[key] = num(sumDecimals(report.rows.map((r) => (typeof r[key] === "number" ? (r[key] as number) : 0))), report.currency);
  }
  if (label) totals[label.key] = label.text;
  return { ...report, totals };
}

function otherCurrencyNote(ds: ReportDataset, predicate: (d: Doc) => boolean = counted): string[] {
  const other = ds.documents.filter((d) => d.currency !== ds.currency && predicate(d)).length;
  return other > 0 ? [`${other} document(s) in another currency are not included. Choose that currency to see them.`] : [];
}

const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({ key, label, type });

// ---------------------------------------------------------------------------------------------
// Sales and VAT contributions (shared so the two reports always agree)
// ---------------------------------------------------------------------------------------------
export type ContributionKind = "invoice" | "advance" | "credit_note" | "advance_deduction";

export interface Contribution {
  date: string;
  kind: ContributionKind;
  document: Doc;
  ht: number;
  vat: number;
  ttc: number;
}

/**
 * What each document adds to sales and VAT in a period.
 *  - Invoices and advance invoices add their amounts when issued.
 *  - Credit notes subtract theirs.
 *  - Advances deducted from a final invoice subtract the HT/VAT they already carried (the final invoice
 *    shows its full value, so without this the advance would be counted twice).
 */
export function salesContributions(ds: ReportDataset, range: Range): Contribution[] {
  const out: Contribution[] = [];
  const byId = new Map(ds.documents.map((d) => [d.id, d]));
  for (const d of ds.documents) {
    if (d.currency !== ds.currency || !counted(d) || !inRange(d.issue_date, range)) continue;
    if (d.document_type === "invoice" || d.document_type === "advance") {
      out.push({ date: d.issue_date, kind: d.document_type, document: d, ht: d.net_ht, vat: d.tax_total, ttc: d.total_ttc });
    } else if (d.document_type === "credit_note") {
      out.push({ date: d.issue_date, kind: "credit_note", document: d, ht: -d.net_ht, vat: -d.tax_total, ttc: -d.total_ttc });
    }
  }
  for (const link of ds.advanceLinks) {
    const invoice = byId.get(link.invoice_id);
    const date = link.created_at.slice(0, 10);
    if (!invoice || invoice.currency !== ds.currency || !counted(invoice) || !inRange(date, range)) continue;
    out.push({ date, kind: "advance_deduction", document: invoice, ht: -link.ht_amount, vat: -link.vat_amount, ttc: -link.amount });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. Sales summary
// ---------------------------------------------------------------------------------------------
export function salesSummaryReport(ds: ReportDataset, range: Range): Report {
  const contributions = salesContributions(ds, range);
  const rows: ReportRow[] = monthsInRange(range.from, range.to).map((month) => {
    const inMonth = contributions.filter((c) => c.date.startsWith(month));
    const sum = (kinds: ContributionKind[], field: "ht" | "vat" | "ttc") =>
      num(sumDecimals(inMonth.filter((c) => kinds.includes(c.kind)).map((c) => c[field])), ds.currency);
    return {
      month,
      invoices: inMonth.filter((c) => c.kind === "invoice" || c.kind === "advance").length,
      invoicedHt: sum(["invoice", "advance"], "ht"),
      creditsHt: sum(["credit_note"], "ht"),
      advancesHt: sum(["advance_deduction"], "ht"),
      netHt: sum(["invoice", "advance", "credit_note", "advance_deduction"], "ht"),
      netVat: sum(["invoice", "advance", "credit_note", "advance_deduction"], "vat"),
      netTtc: sum(["invoice", "advance", "credit_note", "advance_deduction"], "ttc"),
    };
  });
  const report = base(
    ds,
    "sales-summary",
    range,
    [
      col("month", "Month"),
      col("invoices", "Invoices issued", "number"),
      col("invoicedHt", "Invoiced HT", "money"),
      col("creditsHt", "Credit notes HT", "money"),
      col("advancesHt", "Advances already invoiced HT", "money"),
      col("netHt", "Net sales HT", "money"),
      col("netVat", "Net VAT", "money"),
      col("netTtc", "Net sales TTC", "money"),
    ],
    rows,
    [
      "Credit notes and advances already invoiced are shown as negative amounts, so net sales are not counted twice.",
      "Cancelled documents and drafts are excluded.",
      ...otherCurrencyNote(ds),
    ],
  );
  return withTotals(report, ["invoices", "invoicedHt", "creditsHt", "advancesHt", "netHt", "netVat", "netTtc"], { key: "month", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 2. Invoice register
// ---------------------------------------------------------------------------------------------
export function invoiceRegisterReport(ds: ReportDataset, range: Range): Report {
  const rows: ReportRow[] = ds.documents
    .filter((d) => d.currency === ds.currency && isReceivable(d) && issued(d) && inRange(d.issue_date, range))
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || (a.number ?? "").localeCompare(b.number ?? ""))
    .map((d) => {
      const customer = ds.customers.find((c) => c.id === d.customer_id);
      const cancelled = d.status === "void";
      return {
        number: d.number,
        type: d.document_type === "advance" ? "Advance" : "Invoice",
        date: d.issue_date,
        customer: d.customer_name,
        niu: customer?.niu ?? null,
        status: d.status.replace(/_/g, " "),
        netHt: cancelled ? 0 : d.net_ht,
        vat: cancelled ? 0 : d.tax_total,
        totalTtc: cancelled ? 0 : d.total_ttc,
        withholding: cancelled ? 0 : d.withholding_total,
        netPayable: cancelled ? 0 : d.net_payable,
        paid: d.paid_amount,
        balance: d.balance_due,
      };
    });
  const report = base(
    ds,
    "invoice-register",
    range,
    [
      col("number", "Number"),
      col("type", "Type"),
      col("date", "Date", "date"),
      col("customer", "Customer"),
      col("niu", "Customer NIU"),
      col("status", "Status"),
      col("netHt", "Net HT", "money"),
      col("vat", "VAT", "money"),
      col("totalTtc", "Total TTC", "money"),
      col("withholding", "Withholding", "money"),
      col("netPayable", "Net payable", "money"),
      col("paid", "Paid", "money"),
      col("balance", "Balance due", "money"),
    ],
    rows,
    ["Cancelled invoices stay in the register (the number is kept) with their amounts shown as 0.", ...otherCurrencyNote(ds, (d) => isReceivable(d) && counted(d))],
  );
  return withTotals(report, ["netHt", "vat", "totalTtc", "withholding", "netPayable", "paid", "balance"], { key: "number", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 3. Payments
// ---------------------------------------------------------------------------------------------
export function paymentsReport(ds: ReportDataset, range: Range): Report {
  const payments = ds.payments.filter((p) => p.currency === ds.currency && inRange(p.payment_date, range));
  const rows: ReportRow[] = [...payments]
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.created_at.localeCompare(b.created_at))
    .map((p) => ({
      date: p.payment_date,
      customer: p.customer_name,
      method: p.is_adjustment ? "Adjustment" : p.method.replace(/_/g, " "),
      reference: p.reference,
      invoices: p.allocations.map((a) => a.document_number ?? "").filter(Boolean).join(", "),
      amount: p.voided_at ? 0 : p.amount,
      status: p.voided_at ? `Cancelled: ${p.void_reason ?? ""}`.trim() : "Received",
    }));
  const live = payments.filter((p) => !p.voided_at);
  const byMethod = new Map<string, Dec>();
  for (const p of live) {
    const key = p.is_adjustment ? "adjustment" : p.method.replace(/_/g, " ");
    byMethod.set(key, (byMethod.get(key) ?? ZERO).plus(p.amount));
  }
  const notes = [
    ...[...byMethod.entries()].map(([method, total]) => `${method}: ${num(total, ds.currency).toLocaleString("en-US")} ${ds.currency}`),
    "Cancelled payments are listed for the record and count as 0.",
  ];
  const report = base(
    ds,
    "payments",
    range,
    [
      col("date", "Date", "date"),
      col("customer", "Customer"),
      col("method", "Method"),
      col("reference", "Reference"),
      col("invoices", "Invoices"),
      col("amount", "Amount", "money"),
      col("status", "Status"),
    ],
    rows,
    notes,
  );
  return withTotals(report, ["amount"], { key: "date", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 4. Outstanding receivables  /  5. Aging
// ---------------------------------------------------------------------------------------------
const OPEN = new Set(["issued", "sent", "partially_paid", "overdue"]);
const openReceivables = (ds: ReportDataset) =>
  ds.documents.filter((d) => d.currency === ds.currency && isReceivable(d) && OPEN.has(d.status) && d.balance_due > 0);

export function outstandingReceivablesReport(ds: ReportDataset): Report {
  const rows: ReportRow[] = openReceivables(ds)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || (a.number ?? "").localeCompare(b.number ?? ""))
    .map((d) => ({
      number: d.number,
      customer: d.customer_name,
      issueDate: d.issue_date,
      dueDate: d.due_date,
      daysOverdue: daysOverdue(d.due_date, ds.today),
      status: d.due_date && d.due_date < ds.today ? "overdue" : d.status.replace(/_/g, " "),
      netPayable: d.net_payable,
      paid: d.paid_amount + d.credited_amount + d.advance_applied_amount,
      balance: d.balance_due,
    }));
  const report = base(
    ds,
    "outstanding-receivables",
    null,
    [
      col("number", "Invoice"),
      col("customer", "Customer"),
      col("issueDate", "Issued", "date"),
      col("dueDate", "Due", "date"),
      col("daysOverdue", "Days overdue", "number"),
      col("status", "Status"),
      col("netPayable", "Net payable", "money"),
      col("paid", "Paid / credited", "money"),
      col("balance", "Balance due", "money"),
    ],
    rows,
    [`As of ${ds.today}.`, ...otherCurrencyNote(ds, (d) => isReceivable(d) && OPEN.has(d.status) && d.balance_due > 0)],
  );
  return withTotals(report, ["netPayable", "paid", "balance"], { key: "number", text: "Total" });
}

export function agingReport(ds: ReportDataset): Report {
  const perCustomer = new Map<string, { name: string; buckets: Record<AgingBucket, Dec> }>();
  for (const d of openReceivables(ds)) {
    const entry =
      perCustomer.get(d.customer_id) ??
      { name: d.customer_name, buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, ZERO])) as Record<AgingBucket, Dec> };
    const bucket = agingBucket(d.due_date, ds.today);
    entry.buckets[bucket] = entry.buckets[bucket].plus(d.balance_due);
    perCustomer.set(d.customer_id, entry);
  }
  const rows: ReportRow[] = [...perCustomer.values()]
    .map((e) => {
      const row: ReportRow = { customer: e.name };
      for (const b of AGING_BUCKETS) row[b] = num(e.buckets[b], ds.currency);
      row.total = num(sumDecimals(AGING_BUCKETS.map((b) => e.buckets[b])), ds.currency);
      return row;
    })
    .sort((a, b) => (b.total as number) - (a.total as number));
  const report = base(
    ds,
    "aging",
    null,
    [
      col("customer", "Customer"),
      ...AGING_BUCKETS.map((b) => col(b, AGING_LABELS[b], "money")),
      col("total", "Total", "money"),
    ],
    rows,
    [`As of ${ds.today}. Days are counted from the due date.`, ...otherCurrencyNote(ds, (d) => isReceivable(d) && OPEN.has(d.status) && d.balance_due > 0)],
  );
  return withTotals(report, [...AGING_BUCKETS, "total"], { key: "customer", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 6. VAT summary
// ---------------------------------------------------------------------------------------------
/** VAT collected on a cash basis: the VAT share of each payment received in the period. */
export function cashBasisVat(ds: ReportDataset, range: Range): number {
  const byId = new Map(ds.documents.map((d) => [d.id, d]));
  const parts: Dec[] = [];
  for (const payment of ds.payments) {
    if (payment.voided_at || payment.currency !== ds.currency || !inRange(payment.payment_date, range)) continue;
    for (const allocation of payment.allocations) {
      const doc = byId.get(allocation.document_id);
      if (!doc || !isReceivable(doc) || doc.net_payable <= 0 || doc.tax_total <= 0) continue;
      parts.push(roundMoney(new D(allocation.amount).times(doc.tax_total).dividedBy(doc.net_payable), ds.currency));
    }
  }
  return num(sumDecimals(parts), ds.currency);
}

export function vatSummaryReport(ds: ReportDataset, range: Range): Report {
  const contributions = salesContributions(ds, range);
  const itemsByDoc = new Map<string, ReportDataset["items"][number][]>();
  for (const item of ds.items) {
    const list = itemsByDoc.get(item.document_id) ?? [];
    list.push(item);
    itemsByDoc.set(item.document_id, list);
  }

  const rows: ReportRow[] = [];
  const addByRate = (label: string, kinds: ContributionKind[], sign: 1 | -1) => {
    const groups = new Map<number, { base: Dec; vat: Dec }>();
    for (const c of contributions.filter((x) => kinds.includes(x.kind))) {
      for (const item of itemsByDoc.get(c.document.id) ?? []) {
        const g = groups.get(item.tax_rate) ?? { base: ZERO, vat: ZERO };
        g.base = g.base.plus(item.taxable_amount);
        g.vat = g.vat.plus(item.tax_amount);
        groups.set(item.tax_rate, g);
      }
    }
    for (const [rate, g] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      rows.push({
        section: label,
        rate,
        taxable: num(g.base.times(sign), ds.currency),
        vat: num(g.vat.times(sign), ds.currency),
      });
    }
  };
  addByRate("Invoices and advance invoices", ["invoice", "advance"], 1);
  addByRate("Credit notes (VAT reversed)", ["credit_note"], -1);

  const deducted = contributions.filter((c) => c.kind === "advance_deduction");
  if (deducted.length > 0) {
    rows.push({
      section: "Advances deducted from final invoices (VAT already declared on the advance)",
      rate: null,
      taxable: num(sumDecimals(deducted.map((c) => c.ht)), ds.currency),
      vat: num(sumDecimals(deducted.map((c) => c.vat)), ds.currency),
    });
  }

  const collected = cashBasisVat(ds, range);
  const netVat = num(sumDecimals(rows.map((r) => r.vat as number)), ds.currency);
  const report = base(
    ds,
    "vat-summary",
    range,
    [col("section", "Section"), col("rate", "VAT rate", "percent"), col("taxable", "Taxable base (HT)", "money"), col("vat", "VAT", "money")],
    rows,
    [
      VAT_DISCLAIMER,
      `Net VAT charged in the period (accrual basis, after credit notes and advances): ${netVat.toLocaleString("en-US")} ${ds.currency}.`,
      `VAT collected on payments received in the period (cash basis): ${collected.toLocaleString("en-US")} ${ds.currency}. ` +
        "Each payment counts for the VAT share of the invoice it settles.",
      "Cancelled documents and drafts are excluded.",
      ...otherCurrencyNote(ds),
    ],
  );
  const withSums = withTotals(report, ["taxable", "vat"], { key: "section", text: "Net VAT charged (accrual)" });
  // Taxable bases of different rates are summed for information only; the VAT total is the meaningful one.
  return { ...withSums, totals: { ...withSums.totals, vat: netVat } };
}

// ---------------------------------------------------------------------------------------------
// 7. Customer statement (as a report)
// ---------------------------------------------------------------------------------------------
export function customerStatementReport(ds: ReportDataset, range: Range, customerId: string | null): Report {
  const customer = ds.customers.find((c) => c.id === customerId);
  const columns = [
    col("date", "Date", "date"),
    col("reference", "Reference"),
    col("description", "Description"),
    col("debit", "Debit", "money"),
    col("credit", "Credit", "money"),
    col("balance", "Balance", "money"),
  ];
  if (!customer) {
    return base(ds, "customer-statement", range, columns, [], ["Choose a customer to build the statement."]);
  }
  const statement = buildCustomerStatement({
    customer,
    currency: ds.currency,
    from: range.from,
    to: range.to,
    documents: ds.documents,
    payments: ds.payments,
    allocations: ds.payments.flatMap((p) => p.allocations),
    creditLinks: ds.creditLinks,
    advanceLinks: ds.advanceLinks,
  });
  const rows: ReportRow[] = [
    { date: range.from, reference: null, description: "Opening balance", debit: null, credit: null, balance: statement.openingBalance },
    ...statement.entries.map((e) => ({
      date: e.date,
      reference: e.reference,
      description: e.description,
      debit: e.debit || null,
      credit: e.credit || null,
      balance: e.balance,
    })),
    { date: range.to, reference: null, description: "Closing balance", debit: statement.totalDebit, credit: statement.totalCredit, balance: statement.closingBalance },
  ];
  const report = base(ds, "customer-statement", range, columns, rows, [
    `Statement for ${customer.name}. Debits are net payable amounts of issued invoices; credits are payments, credit notes and advances deducted.`,
  ]);
  return report;
}

// ---------------------------------------------------------------------------------------------
// 8. Proforma conversion
// ---------------------------------------------------------------------------------------------
export function proformaConversionReport(ds: ReportDataset, range: Range): Report {
  const byId = new Map(ds.documents.map((d) => [d.id, d]));
  const proformas = ds.documents.filter(
    (d) => d.currency === ds.currency && d.document_type === "proforma" && issued(d) && inRange(d.issue_date, range),
  );
  const rows: ReportRow[] = proformas
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
    .map((p) => {
      const invoice = ds.documents.find((d) => d.converted_from_document_id === p.id && d.document_type === "invoice" && issued(d));
      const expired = (p.status === "issued" || p.status === "sent") && p.valid_until !== null && p.valid_until < ds.today;
      const days = invoice
        ? Math.max(0, Math.round((Date.parse(invoice.issue_date) - Date.parse(p.issue_date)) / 86_400_000))
        : null;
      return {
        number: p.number,
        date: p.issue_date,
        customer: p.customer_name,
        total: p.total_ttc,
        status: expired ? "expired (validity passed)" : p.status.replace(/_/g, " "),
        invoice: invoice?.number ?? null,
        invoiceStatus: invoice ? invoice.status.replace(/_/g, " ") : null,
        days,
      };
    });
  const converted = rows.filter((r) => r.invoice).length;
  const rate = rows.length > 0 ? Math.round((converted / rows.length) * 1000) / 10 : 0;
  void byId;
  const report = base(
    ds,
    "proforma-conversion",
    range,
    [
      col("number", "Proforma"),
      col("date", "Date", "date"),
      col("customer", "Customer"),
      col("total", "Total TTC", "money"),
      col("status", "Status"),
      col("invoice", "Invoice"),
      col("invoiceStatus", "Invoice status"),
      col("days", "Days to convert", "number"),
    ],
    rows,
    [`${converted} of ${rows.length} proforma(s) converted into an invoice (${rate}%).`, ...otherCurrencyNote(ds, (d) => d.document_type === "proforma" && issued(d))],
  );
  return withTotals(report, ["total"], { key: "number", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 9. Credit notes
// ---------------------------------------------------------------------------------------------
export function creditNotesReport(ds: ReportDataset, range: Range): Report {
  const byId = new Map(ds.documents.map((d) => [d.id, d]));
  const rows: ReportRow[] = ds.documents
    .filter((d) => d.currency === ds.currency && d.document_type === "credit_note" && issued(d) && inRange(d.issue_date, range))
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || (a.number ?? "").localeCompare(b.number ?? ""))
    .map((n) => {
      const link = ds.creditLinks.find((l) => l.credit_note_id === n.id);
      const invoice = byId.get(link?.invoice_id ?? "") ?? ds.documents.find((d) => d.number === n.reference);
      const cancelled = n.status === "void";
      return {
        number: n.number,
        date: n.issue_date,
        customer: n.customer_name,
        invoice: invoice?.number ?? n.reference,
        reason: n.notes,
        netHt: cancelled ? 0 : n.net_ht,
        vat: cancelled ? 0 : n.tax_total,
        totalTtc: cancelled ? 0 : n.total_ttc,
        status: cancelled ? `cancelled: ${n.void_reason ?? ""}`.trim() : "issued",
      };
    });
  const report = base(
    ds,
    "credit-notes",
    range,
    [
      col("number", "Credit note"),
      col("date", "Date", "date"),
      col("customer", "Customer"),
      col("invoice", "Credits invoice"),
      col("reason", "Reason"),
      col("netHt", "HT", "money"),
      col("vat", "VAT", "money"),
      col("totalTtc", "Total TTC", "money"),
      col("status", "Status"),
    ],
    rows,
    ["Cancelled credit notes are listed for the record and count as 0.", ...otherCurrencyNote(ds, (d) => d.document_type === "credit_note" && issued(d))],
  );
  return withTotals(report, ["netHt", "vat", "totalTtc"], { key: "number", text: "Total" });
}

// ---------------------------------------------------------------------------------------------
// 10. Invoice number audit
// ---------------------------------------------------------------------------------------------
/** Split "PS-INV-2026-0042" into its sequence prefix and number. */
export function parseDocumentNumber(value: string): { prefix: string; sequence: number; width: number } | null {
  const match = /^(.*?)(\d+)$/.exec(value);
  if (!match) return null;
  return { prefix: match[1] ?? "", sequence: Number(match[2]), width: (match[2] ?? "").length };
}

export function invoiceNumberAuditReport(ds: ReportDataset): Report {
  const numbered = ds.documents.filter((d) => issued(d));
  const groups = new Map<string, Array<{ doc: Doc; sequence: number; width: number }>>();
  for (const doc of numbered) {
    const parsed = parseDocumentNumber(doc.number!);
    if (!parsed) continue;
    const key = `${doc.document_type}|${parsed.prefix}`;
    const list = groups.get(key) ?? [];
    list.push({ doc, sequence: parsed.sequence, width: parsed.width });
    groups.set(key, list);
  }

  const rows: ReportRow[] = [];
  let gaps = 0;
  let voids = 0;
  for (const [key, entries] of [...groups.entries()].sort()) {
    const [type, prefix] = key.split("|") as [string, string];
    entries.sort((a, b) => a.sequence - b.sequence);
    const seen = new Set(entries.map((e) => e.sequence));
    const width = entries[0]?.width ?? 4;
    const min = entries[0]!.sequence;
    const max = entries[entries.length - 1]!.sequence;
    for (let n = min; n <= max; n++) {
      if (seen.has(n)) {
        for (const { doc } of entries.filter((e) => e.sequence === n)) {
          const cancelled = doc.status === "void";
          if (cancelled) voids += 1;
          rows.push({
            number: doc.number,
            type: type.replace(/_/g, " "),
            date: doc.issue_date,
            status: doc.status.replace(/_/g, " "),
            customer: doc.customer_name,
            total: doc.total_ttc,
            finding: cancelled ? "Cancelled" : "OK",
            explanation: cancelled
              ? `${doc.void_reason ?? "No reason recorded"}${doc.voided_at ? ` (cancelled ${doc.voided_at.slice(0, 10)})` : ""}`
              : null,
          });
        }
      } else {
        gaps += 1;
        rows.push({
          number: `${prefix}${String(n).padStart(width, "0")}`,
          type: type.replace(/_/g, " "),
          date: null,
          status: "missing",
          customer: null,
          total: null,
          finding: "GAP",
          explanation: "No document carries this number. Numbers are only allocated when a document is issued, so investigate.",
        });
      }
    }
  }

  return base(
    ds,
    "invoice-number-audit",
    null,
    [
      col("number", "Number"),
      col("type", "Type"),
      col("date", "Date", "date"),
      col("status", "Status"),
      col("customer", "Customer"),
      col("total", "Total TTC", "money"),
      col("finding", "Finding"),
      col("explanation", "Explanation"),
    ],
    rows,
    [
      gaps === 0 ? "No gaps found in the numbering." : `${gaps} gap(s) found in the numbering.`,
      `${voids} cancelled document(s): their numbers are kept and the reason is recorded.`,
      "Each numbering series (document type and prefix, per year when numbering restarts yearly) is checked between its first and last number.",
    ],
  );
}
