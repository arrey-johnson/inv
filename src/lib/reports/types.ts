import type { CurrencyCode } from "@/lib/finance/money";
import type {
  AdvanceLink,
  CreditNoteLink,
  Customer,
  DocumentItem,
  DocumentRow,
} from "@/types/database";
import type { PaymentListRow } from "@/lib/data/types";

export const REPORT_IDS = [
  "sales-summary",
  "invoice-register",
  "payments",
  "outstanding-receivables",
  "aging",
  "vat-summary",
  "customer-statement",
  "proforma-conversion",
  "credit-notes",
  "invoice-number-audit",
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export type ColumnType = "text" | "money" | "date" | "number" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

/** A tabular report. The same structure feeds the screen, the CSV and the Excel export. */
export interface Report {
  id: ReportId;
  title: string;
  description: string;
  currency: CurrencyCode;
  /** Inclusive period, or null for "as of today" reports. */
  period: { from: string; to: string } | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Totals row, keyed by column key (columns without a total are omitted). */
  totals: ReportRow | null;
  /** Remarks and disclaimers printed under the table and exported with it. */
  notes: string[];
}

/** Everything the report builders read. Pure data: the builders never touch the repository. */
export interface ReportDataset {
  today: string;
  currency: CurrencyCode;
  documents: ReadonlyArray<DocumentRow & { customer_name: string }>;
  items: ReadonlyArray<DocumentItem>;
  payments: ReadonlyArray<PaymentListRow>;
  creditLinks: ReadonlyArray<CreditNoteLink>;
  advanceLinks: ReadonlyArray<AdvanceLink>;
  customers: ReadonlyArray<Pick<Customer, "id" | "name" | "niu">>;
}

export const REPORT_META: Record<ReportId, { title: string; description: string; usesPeriod: boolean }> = {
  "sales-summary": { title: "Sales summary", description: "Invoiced sales by month: net of credit notes and of advances already invoiced.", usesPeriod: true },
  "invoice-register": { title: "Invoice register", description: "Every invoice issued in the period with its amounts and settlement.", usesPeriod: true },
  payments: { title: "Payments", description: "Payments received in the period, with the invoices they settled.", usesPeriod: true },
  "outstanding-receivables": { title: "Outstanding receivables", description: "Invoices with a balance still due, as of today.", usesPeriod: false },
  aging: { title: "Receivables aging", description: "Open balances by customer, grouped by how late they are.", usesPeriod: false },
  "vat-summary": { title: "VAT summary", description: "VAT charged, reversed and collected. An accounting aid, not an official return.", usesPeriod: true },
  "customer-statement": { title: "Customer statement", description: "One customer's invoices, credits and payments with a running balance.", usesPeriod: true },
  "proforma-conversion": { title: "Proforma conversion", description: "Proformas issued in the period and what became of them.", usesPeriod: true },
  "credit-notes": { title: "Credit notes", description: "Credit notes issued in the period and the invoices they credit.", usesPeriod: true },
  "invoice-number-audit": { title: "Invoice number audit", description: "Official numbers in order: gaps and cancelled documents with their reasons.", usesPeriod: false },
};

export function isReportId(value: unknown): value is ReportId {
  return typeof value === "string" && (REPORT_IDS as readonly string[]).includes(value);
}
