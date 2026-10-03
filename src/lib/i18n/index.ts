/**
 * Minimal i18n scaffold. The product is English-first today; French is the obvious next locale for
 * Cameroon. All user-visible document labels that end up on PDFs should move through `t()` so adding
 * `fr` later is a dictionary exercise, not a refactor.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const en = {
  "document.invoice": "Invoice",
  "document.proforma": "Proforma invoice",
  "document.credit_note": "Credit note",
  "document.receipt": "Payment receipt",
  "document.advance": "Advance receipt",
  "table.description": "Description",
  "table.quantity": "Qty",
  "table.unit_price": "Unit price",
  "table.discount": "Disc.",
  "table.vat": "VAT",
  "table.total_ht": "Total HT",
  "totals.subtotal": "Subtotal",
  "totals.net_ht": "Net total (HT)",
  "totals.vat": "VAT",
  "totals.total_ttc": "TOTAL (TTC)",
  "totals.balance_due": "Balance due",
} as const;

export type MessageKey = keyof typeof en;

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en };

export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return dictionaries[locale][key] ?? en[key];
}
