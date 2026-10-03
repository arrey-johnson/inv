import { sumDecimals } from "@/lib/finance/money";
import type { DocumentListRow } from "@/lib/data/types";

export interface CustomerSummary {
  invoiceCount: number;
  proformaCount: number;
  /** Total TTC of issued (non-void) invoices. */
  invoiced: number;
  /** Payments + credit notes + advances applied (0 until Phase 3 wires payments). */
  settled: number;
  /** Open balance due. */
  outstanding: number;
}

/** Customer totals derived from their documents. Decimal arithmetic only. */
export function summarizeCustomerDocuments(rows: ReadonlyArray<DocumentListRow>): CustomerSummary {
  const invoices = rows.filter((d) => d.document_type === "invoice" && d.status !== "draft" && d.status !== "void");
  return {
    invoiceCount: rows.filter((d) => d.document_type === "invoice").length,
    proformaCount: rows.filter((d) => d.document_type === "proforma").length,
    invoiced: sumDecimals(invoices.map((d) => d.total_ttc)).toNumber(),
    settled: sumDecimals(invoices.map((d) => d.paid_amount + d.credited_amount + d.advance_applied_amount)).toNumber(),
    // Unpaid advance (deposit) invoices are owed too; their payment is also what settles the final invoice later.
    outstanding: sumDecimals(
      rows.filter((d) => (d.document_type === "invoice" || d.document_type === "advance") && d.status !== "draft" && d.status !== "void").map((d) => d.balance_due),
    ).toNumber(),
  };
}
