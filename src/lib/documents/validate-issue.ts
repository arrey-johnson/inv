import { FinanceCalculationError } from "@/lib/finance/calculate-document";
import { toDecimal } from "@/lib/finance/money";
import type {
  Customer,
  DocumentItem,
  DocumentRow,
  DocumentWithholding,
  Organization,
  OrganizationSettings,
  PaymentDestination,
} from "@/types/database";
import { customerNiuWarning } from "@/lib/customers/niu";
import { computeResolved, resolvedFromBundle, storedTotalsMatch } from "./build";
import { isSalesDocumentType } from "./status";

export interface IssueIssue {
  code: string;
  message: string;
  /** Line number (1-based) when the problem belongs to a specific line. */
  line?: number;
}

export interface IssueCheckResult {
  /** True when there are no blocking errors (warnings never block). */
  ok: boolean;
  errors: IssueIssue[];
  warnings: IssueIssue[];
}

export interface IssueCheckInput {
  document: DocumentRow;
  items: ReadonlyArray<DocumentItem>;
  withholdings?: ReadonlyArray<DocumentWithholding>;
  customer: Customer | null;
  organization: Organization | null;
  settings: OrganizationSettings | null;
  destinations?: ReadonlyArray<PaymentDestination>;
}

/**
 * Everything that must be true before a draft becomes an official document. Pure: the same function
 * backs the "ready to issue?" panel and the server-side guard (which re-runs it against fresh data).
 * The database `issue_document()` enforces the structural subset again as the last line of defence.
 */
export function validateDocumentForIssue(input: IssueCheckInput): IssueCheckResult {
  const errors: IssueIssue[] = [];
  const warnings: IssueIssue[] = [];
  const { document: doc, items, customer, organization, settings } = input;
  const error = (code: string, message: string, line?: number) => errors.push({ code, message, line });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  if (!isSalesDocumentType(doc.document_type)) {
    error("unsupported_type", "This document type cannot be issued from here.");
  }
  if (doc.status !== "draft") {
    error("not_draft", `Only drafts can be issued (this document is ${doc.status}).`);
  }

  if (!customer) {
    error("customer_missing", "The customer no longer exists.");
  } else {
    if (!customer.is_active) error("customer_inactive", "The customer is inactive. Reactivate it or choose another customer.");
    if (!customer.name.trim()) error("customer_name", "The customer has no name.");
    const niuWarning = customerNiuWarning(customer);
    if (niuWarning) warn("customer_niu_missing", niuWarning);
  }

  if (!organization || !organization.legal_name.trim()) {
    error("issuer_missing", "Company legal name is missing (Settings > Company).");
  } else if (!organization.niu?.trim()) {
    warn("issuer_niu_missing", "Company NIU is not set (Settings > Company). It will not be printed on this document.");
  }

  const hasDestination =
    (input.destinations ?? []).some((d) => d.is_active && d.show_on_documents) ||
    Boolean(settings?.bank_account_number || settings?.mobile_money_number || settings?.bank_iban);
  if ((doc.document_type === "invoice" || doc.document_type === "advance") && !hasDestination) {
    warn("no_payment_details", "No bank or mobile money destination is configured, so payment details will not be printed.");
  }

  if (items.length === 0) {
    error("no_lines", "Add at least one line before issuing.");
  }
  [...items]
    .sort((a, b) => a.position - b.position)
    .forEach((item, index) => {
      const line = index + 1;
      if (!item.description.trim()) error("line_description", "Description is required.", line);
      if (toDecimal(item.quantity).lessThanOrEqualTo(0)) error("line_quantity", "Quantity must be greater than zero.", line);
      if (toDecimal(item.unit_price).isNegative()) error("line_price", "Unit price cannot be negative.", line);
    });

  if (doc.due_date && doc.due_date < doc.issue_date) error("due_before_issue", "The due date is before the issue date.");
  if (doc.valid_until && doc.valid_until < doc.issue_date) error("valid_before_issue", "The validity date is before the issue date.");

  if (settings?.require_approval && doc.approval_status !== "approved") {
    error("approval_required", "This document must be approved before it can be issued.");
  }

  // Server-side recalculation: stored totals must equal a fresh run of the finance engine.
  if (items.length > 0) {
    try {
      const calc = computeResolved(resolvedFromBundle({ document: doc, items: [...items], withholdings: [...(input.withholdings ?? [])] }));
      if (calc.totalTTC <= 0) error("zero_total", "The document total must be greater than zero.");
      if (!storedTotalsMatch(doc, items, calc)) {
        error("totals_out_of_sync", "Stored totals do not match the lines. Save the draft again to recalculate.");
      }
    } catch (cause) {
      if (cause instanceof FinanceCalculationError) error("calculation", cause.message);
      else throw cause;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
