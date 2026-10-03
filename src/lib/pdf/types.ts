import type { CalcDocumentResult } from "@/lib/finance/calculate-document";
import type { CurrencyCode } from "@/lib/finance/money";

export type PdfDocumentType = "invoice" | "proforma" | "credit_note" | "receipt" | "advance";

/** Mirrors the `document_status` DB enum (kept loose so the renderer has no DB dependency). */
export type PdfDocumentStatus =
  | "draft"
  | "issued"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "credited"
  | "void";

export interface PdfParty {
  name: string;
  /** Free-form address lines, top to bottom. Empty/blank lines are skipped. */
  addressLines?: ReadonlyArray<string | null | undefined>;
  /** Tax payer number (NIU). Printed only when provided - never invented. */
  niu?: string | null;
  /** Trade register number (RCCM). Printed only when provided. */
  rccm?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PdfLine {
  description: string;
  /** Optional second line (item code, SKU, remark). */
  details?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  /** Human label such as "10%" or "5,000"; blank when no discount. */
  discountLabel?: string | null;
  taxRate: number;
  /** Line net HT after line discount. */
  netAmount: number;
}

export interface PdfBankDetails {
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swift?: string | null;
  mobileMoney?: string | null;
}

export interface PdfDocumentData {
  type: PdfDocumentType;
  status: PdfDocumentStatus;
  number: string;
  issueDate: string;
  dueDate?: string | null;
  currency: CurrencyCode;
  /** Legal identity of the issuer - only fields the admin has filled in are printed. */
  issuer: PdfParty;
  customer: PdfParty;
  /** Extra label/value rows in the meta block (PO number, linked invoice, payment method...). */
  metaRows?: ReadonlyArray<{ label: string; value: string }>;
  lines: ReadonlyArray<PdfLine>;
  /** Output of `calculateDocument` - the renderer never recomputes money. */
  calc: CalcDocumentResult;
  /** Settlement info shown under the totals (invoices). */
  settlement?: {
    paidAmount: number;
    balanceDue: number;
    /**
     * Itemised deductions printed instead of the single "Paid / credited" row: advances already invoiced and
     * paid, credit notes, payments received. Amounts are positive; the renderer prints them as deductions.
     */
    rows?: ReadonlyArray<{ label: string; amount: number }>;
  } | null;
  notes?: string | null;
  terms?: string | null;
  bank?: PdfBankDetails | null;
  /** Optional free-text payment instructions. */
  paymentInstructions?: string | null;
  /** Public verification URL printed as small text (QR support arrives in a later phase). */
  verificationUrl?: string | null;
  /** Authorized signatory printed under the stamp (only with a stamp, only when configured). */
  signatory?: { name?: string | null; position?: string | null } | null;
}

export interface PdfRenderAssets {
  /** Bytes of the official letterhead PDF (single page, A4). Server-side only. */
  letterheadPdf: Uint8Array;
  /** Bytes of the company stamp PNG. Server-side only; omit to render without a stamp. */
  stampPng?: Uint8Array | null;
}

export interface PdfRenderOptions {
  /**
   * Force stamp on/off. When undefined the stamp is applied for every status except
   * `draft` and `void`.
   */
  applyStamp?: boolean;
  /** Admin-configured stamp placement; omitted values fall back to the layout defaults. */
  stampLayout?: { x?: number | null; y?: number | null; width?: number | null } | null;
  /** Fixed timestamp for reproducible output (tests, and issued documents so their hash is stable). */
  now?: Date;
}
