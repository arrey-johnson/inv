import { z } from "zod";
import { CURRENCY_CODES, D } from "@/lib/finance/money";
import { DOCUMENT_TYPES, PAYMENT_DESTINATION_KINDS, PAYMENT_METHODS, TAX_CATEGORIES, USER_ROLES } from "@/types/database";
import { decimalString, optionalText, requiredInt, requiredText } from "./common";

/** Optional layout measurement (PDF points). Layout values are not money, so a JS number is fine. */
const optionalPoints = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim().replace(",", ".")),
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, `${label} must be a number`)
      .transform(Number)
      .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`)
      .nullable(),
  );

export const taxRateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/, "Use 2-30 letters, digits, - or _ (e.g. VAT_5)"),
  name: requiredText("Name", 100),
  rate: decimalString("Rate", { maxDecimals: 4, max: 100 }).transform((v) => new D(v).toNumber()),
  category: z.enum(TAX_CATEGORIES),
  is_active: z.boolean().default(true),
});
export type TaxRateFormValues = z.input<typeof taxRateSchema>;
export type TaxRateValues = z.output<typeof taxRateSchema>;

export const vatSettingsSchema = z.object({ vat_registered: z.boolean() });

export const paymentMethodsSchema = z.object({
  enabled_payment_methods: z.array(z.enum(PAYMENT_METHODS)).min(1, "Keep at least one accepted method"),
});

export const paymentDestinationSchema = z.object({
  kind: z.enum(PAYMENT_DESTINATION_KINDS),
  label: requiredText("Label", 100),
  provider: optionalText(100),
  account_name: optionalText(150),
  account_number: optionalText(60),
  iban: optionalText(60),
  swift: optionalText(30),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  show_on_documents: z.boolean().default(true),
});
export type PaymentDestinationFormValues = z.input<typeof paymentDestinationSchema>;
export type PaymentDestinationValues = z.output<typeof paymentDestinationSchema>;

export const sequenceSchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES),
    prefix: z.string().trim().min(1, "Prefix is required").max(20, "Prefix is too long").regex(/^[A-Za-z0-9_.-]+$/, "Letters, digits, - _ . only"),
    separator: z.string().max(3, "At most 3 characters").regex(/^[-_./]*$/, "Use - _ . / or leave empty"),
    include_year: z.boolean(),
    reset_yearly: z.boolean(),
    padding: requiredInt("Padding", 1, 12),
    start_number: requiredInt("Start number", 0, 999_999_999),
  })
  // A counter that restarts every year while the number carries no year would produce duplicates.
  .refine((v) => !v.reset_yearly || v.include_year, {
    path: ["reset_yearly"],
    message: "Yearly reset requires the year in the number",
  });
export type SequenceFormValues = z.input<typeof sequenceSchema>;
export type SequenceValues = z.output<typeof sequenceSchema>;

export const invoiceDefaultsSchema = z.object({
  default_currency: z.enum(CURRENCY_CODES),
  default_payment_terms_days: requiredInt("Payment terms", 0, 365),
  proforma_validity_days: requiredInt("Proforma validity", 1, 365),
  show_amount_in_words: z.boolean(),
  default_invoice_notes: optionalText(4000),
  default_invoice_terms: optionalText(4000),
  default_proforma_notes: optionalText(4000),
  default_proforma_terms: optionalText(4000),
});
export type InvoiceDefaultsFormValues = z.input<typeof invoiceDefaultsSchema>;
export type InvoiceDefaultsValues = z.output<typeof invoiceDefaultsSchema>;

export const brandingSettingsSchema = z.object({
  require_approval: z.boolean(),
  stamp_enabled: z.boolean(),
  signatory_name: optionalText(150),
  signatory_position: optionalText(150),
  stamp_x: optionalPoints("Stamp X", 0, 595),
  stamp_y: optionalPoints("Stamp Y", 0, 842),
  stamp_width: optionalPoints("Stamp width", 40, 300),
});
export type BrandingSettingsFormValues = z.input<typeof brandingSettingsSchema>;
export type BrandingSettingsValues = z.output<typeof brandingSettingsSchema>;

export const memberRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(USER_ROLES),
});