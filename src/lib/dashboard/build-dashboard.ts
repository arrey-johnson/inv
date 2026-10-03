import { D, ZERO, roundMoney, sumDecimals, type CurrencyCode, type Dec } from "@/lib/finance/money";
import { isOverdue } from "@/lib/payments/aging";
import { cashBasisVat, salesContributions } from "@/lib/reports/build-reports";
import { inRange, monthsInRange } from "@/lib/reports/date-range";
import type { ReportDataset } from "@/lib/reports/types";

type Doc = ReportDataset["documents"][number];

export interface DashboardData {
  currency: CurrencyCode;
  range: { from: string; to: string };
  invoiced: { ttc: number; ht: number; count: number };
  paid: { amount: number; count: number };
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  vat: { charged: number; collectedOnPayments: number };
  proformasAwaiting: { count: number; total: number };
  recentPayments: Array<{ id: string; date: string; customer: string; amount: number; method: string; invoices: string }>;
  recentInvoices: Array<{ id: string; number: string; date: string; customer: string; total: number; status: string; type: string }>;
  topCustomers: Array<{ customerId: string; name: string; invoiced: number }>;
  monthly: Array<{ month: string; sales: number; paid: number }>;
}

const OPEN = new Set(["issued", "sent", "partially_paid", "overdue"]);
const isReceivable = (d: Doc) => d.document_type === "invoice" || d.document_type === "advance";

/** Dashboard figures from the same dataset the reports use, so the two can never disagree. */
export function buildDashboard(ds: ReportDataset, range: { from: string; to: string }): DashboardData {
  const cur = ds.currency;
  const money = (v: Dec) => roundMoney(v, cur).toNumber();
  const contributions = salesContributions(ds, range);

  const open = ds.documents.filter((d) => d.currency === cur && isReceivable(d) && OPEN.has(d.status) && d.balance_due > 0);
  const late = open.filter((d) => isOverdue(d, ds.today));

  const payments = ds.payments.filter((p) => p.currency === cur && !p.voided_at);
  const paidInRange = payments.filter((p) => inRange(p.payment_date, range));

  const awaiting = ds.documents.filter(
    (d) =>
      d.currency === cur &&
      d.document_type === "proforma" &&
      (d.status === "issued" || d.status === "sent") &&
      (d.valid_until === null || d.valid_until >= ds.today),
  );

  const perCustomer = new Map<string, { name: string; total: Dec }>();
  for (const c of contributions) {
    const entry = perCustomer.get(c.document.customer_id) ?? { name: c.document.customer_name, total: ZERO };
    entry.total = entry.total.plus(c.ttc);
    perCustomer.set(c.document.customer_id, entry);
  }

  // The chart shows at least the six months ending with the selected period.
  const endMonth = range.to.slice(0, 7);
  const startMonth = range.from.slice(0, 7);
  let months = monthsInRange(`${startMonth}-01`, `${endMonth}-28`);
  if (months.length < 6) {
    const [ey, em] = endMonth.split("-").map(Number) as [number, number];
    const first = new Date(Date.UTC(ey, em - 1 - 5, 1));
    months = monthsInRange(`${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-01`, `${endMonth}-28`);
  }
  const monthRange = { from: `${months[0]}-01`, to: `${months[months.length - 1]}-31` };
  const monthlyContrib = salesContributions(ds, monthRange);

  return {
    currency: cur,
    range,
    invoiced: {
      ttc: money(sumDecimals(contributions.map((c) => c.ttc))),
      ht: money(sumDecimals(contributions.map((c) => c.ht))),
      count: contributions.filter((c) => c.kind === "invoice" || c.kind === "advance").length,
    },
    paid: { amount: money(sumDecimals(paidInRange.map((p) => p.amount))), count: paidInRange.length },
    outstanding: { amount: money(sumDecimals(open.map((d) => d.balance_due))), count: open.length },
    overdue: { amount: money(sumDecimals(late.map((d) => d.balance_due))), count: late.length },
    vat: {
      charged: money(sumDecimals(contributions.map((c) => c.vat))),
      collectedOnPayments: cashBasisVat(ds, range),
    },
    proformasAwaiting: { count: awaiting.length, total: money(sumDecimals(awaiting.map((d) => d.total_ttc))) },
    recentPayments: [...payments]
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at))
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        date: p.payment_date,
        customer: p.customer_name,
        amount: p.amount,
        method: p.is_adjustment ? "adjustment" : p.method.replace(/_/g, " "),
        invoices: p.allocations.map((a) => a.document_number ?? "").filter(Boolean).join(", "),
      })),
    recentInvoices: ds.documents
      .filter((d) => isReceivable(d) && d.status !== "draft" && d.number)
      .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.created_at.localeCompare(a.created_at))
      .slice(0, 6)
      .map((d) => ({
        id: d.id,
        number: d.number!,
        date: d.issue_date,
        customer: d.customer_name,
        total: d.total_ttc,
        status: d.status,
        type: d.document_type,
      })),
    topCustomers: [...perCustomer.entries()]
      .map(([customerId, e]) => ({ customerId, name: e.name, invoiced: money(e.total) }))
      .filter((c) => c.invoiced > 0)
      .sort((a, b) => b.invoiced - a.invoiced)
      .slice(0, 5),
    monthly: months.map((month) => ({
      month,
      sales: money(sumDecimals(monthlyContrib.filter((c) => c.date.startsWith(month)).map((c) => c.ht))),
      paid: money(
        sumDecimals(payments.filter((p) => p.payment_date.startsWith(month)).map((p) => new D(p.amount))),
      ),
    })),
  };
}
