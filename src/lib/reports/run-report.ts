import type { Repository } from "@/lib/data/types";
import type { CurrencyCode } from "@/lib/finance/money";
import { todayISO } from "@/lib/utils/date-math";
import {
  agingReport,
  creditNotesReport,
  customerStatementReport,
  invoiceNumberAuditReport,
  invoiceRegisterReport,
  outstandingReceivablesReport,
  paymentsReport,
  proformaConversionReport,
  salesSummaryReport,
  vatSummaryReport,
} from "./build-reports";
import type { Report, ReportDataset, ReportId } from "./types";

export interface ReportRequest {
  id: ReportId;
  currency?: CurrencyCode;
  range: { from: string; to: string };
  customerId?: string | null;
  today?: string;
}

/** Load what a report needs. Only the VAT summary needs the document lines. */
export async function loadReportDataset(repo: Repository, request: ReportRequest): Promise<ReportDataset> {
  const today = request.today ?? todayISO();
  const settings = await repo.organization.getSettings();
  const currency = request.currency ?? settings?.default_currency ?? "XAF";

  const [documents, payments, creditLinks, advanceLinks, customers] = await Promise.all([
    repo.documents.listAll({ today }),
    repo.payments.listAll({ includeVoided: true }),
    repo.settlement.creditLinks(),
    repo.settlement.advanceLinks(),
    repo.customers.listActive(5000),
  ]);

  const known = new Map(customers.map((c) => [c.id, c]));
  if (request.customerId && !known.has(request.customerId)) {
    const extra = await repo.customers.get(request.customerId);
    if (extra) known.set(extra.id, extra);
  }

  const items =
    request.id === "vat-summary"
      ? await repo.documents.listItems(
          documents.filter((d) => d.status !== "draft" && d.status !== "void" && d.currency === currency).map((d) => d.id),
        )
      : [];

  return {
    today,
    currency,
    documents,
    items,
    payments,
    creditLinks,
    advanceLinks,
    customers: [...known.values()].map((c) => ({ id: c.id, name: c.name, niu: c.niu })),
  };
}

export function buildReport(dataset: ReportDataset, request: Pick<ReportRequest, "id" | "range" | "customerId">): Report {
  const { id, range } = request;
  switch (id) {
    case "sales-summary":
      return salesSummaryReport(dataset, range);
    case "invoice-register":
      return invoiceRegisterReport(dataset, range);
    case "payments":
      return paymentsReport(dataset, range);
    case "outstanding-receivables":
      return outstandingReceivablesReport(dataset);
    case "aging":
      return agingReport(dataset);
    case "vat-summary":
      return vatSummaryReport(dataset, range);
    case "customer-statement":
      return customerStatementReport(dataset, range, request.customerId ?? null);
    case "proforma-conversion":
      return proformaConversionReport(dataset, range);
    case "credit-notes":
      return creditNotesReport(dataset, range);
    case "invoice-number-audit":
      return invoiceNumberAuditReport(dataset);
  }
}

export async function runReport(repo: Repository, request: ReportRequest): Promise<Report> {
  return buildReport(await loadReportDataset(repo, request), request);
}
