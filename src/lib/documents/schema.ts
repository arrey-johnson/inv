import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { DISCOUNT_TYPES } from "@/types/database";
import { decimalString, isoDate, optionalIsoDate, optionalText, optionalUuid } from "@/lib/validations/common";

export const documentLineSchema = z
  .object({
    itemId: optionalUuid,
    description: z.string().trim().min(1, "Description is required").max(500, "Description is too long"),
    details: optionalText(1000),
    quantity: decimalString("Quantity", { positive: true, maxDecimals: 4, max: 1_000_000_000 }),
    unit: optionalText(30),
    unitPrice: decimalString("Unit price", { maxDecimals: 4, max: 1_000_000_000_000, emptyAsZero: true }),
    discountType: z.enum(DISCOUNT_TYPES).default("none"),
    discountValue: decimalString("Discount", { maxDecimals: 4, emptyAsZero: true }).default("0"),
    /** Null = no VAT (exempt / VAT disabled). The server resolves the rate from this id. */
    taxRateId: optionalUuid,
  })
  .superRefine((line, ctx) => {
    if (line.discountType === "percentage" && Number(line.discountValue) > 100) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage discount cannot exceed 100" });
    }
  });

export const documentInputSchema = z
  .object({
    documentType: z.enum(["invoice", "proforma", "advance"]),
    customerId: z.string().uuid("Select a customer"),
    issueDate: isoDate("Issue date"),
    dueDate: optionalIsoDate("Due date"),
    validUntil: optionalIsoDate("Valid until"),
    currency: z.enum(CURRENCY_CODES),
    reference: optionalText(120),
    subject: optionalText(255),
    notes: optionalText(4000),
    terms: optionalText(4000),
    internalNotes: optionalText(4000),
    globalDiscountType: z.enum(DISCOUNT_TYPES).default("none"),
    globalDiscountValue: decimalString("Global discount", { maxDecimals: 4, emptyAsZero: true }).default("0"),
    lines: z.array(documentLineSchema).min(1, "Add at least one line").max(200, "Too many lines"),
    /** Configured withholding types to apply. The server resolves the rates; the browser never sends one. */
    withholdingTypeIds: z.array(z.string().uuid("Invalid withholding type")).max(5, "Too many withholdings").default([]),
  })
  .superRefine((doc, ctx) => {
    if (doc.dueDate && doc.dueDate < doc.issueDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date cannot be before the issue date" });
    }
    if (doc.validUntil && doc.validUntil < doc.issueDate) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Validity cannot end before the issue date" });
    }
    if (doc.globalDiscountType === "percentage" && Number(doc.globalDiscountValue) > 100) {
      ctx.addIssue({ code: "custom", path: ["globalDiscountValue"], message: "A percentage discount cannot exceed 100" });
    }
  });

/** What the browser sends (strings typed by the user). */
export type DocumentInputRaw = z.input<typeof documentInputSchema>;
/** Parsed + normalized (decimals as plain strings, empty text as null). */
export type DocumentInput = z.output<typeof documentInputSchema>;
export type DocumentLineInput = z.output<typeof documentLineSchema>;
