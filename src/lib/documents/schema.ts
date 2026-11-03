import { z } from "zod";
import { D, CURRENCY_CODES } from "@/lib/finance/money";
import { DISCOUNT_TYPES } from "@/types/database";
import {
  decimalString,
  isoDate,
  normalizeDecimalText,
  optionalIsoDate,
  optionalText,
  optionalUuid,
} from "@/lib/validations/common";

/** Blank = full amount due. Otherwise 0 < percent <= 100 (100 hides the split on the PDF). */
const dueNowPercentField = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    const text = normalizeDecimalText(raw);
    return text === "" ? null : text;
  })
  .superRefine((value, ctx) => {
    if (value === null) return;
    if (!/^\d+(\.\d+)?$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Due now % must be a number" });
      return;
    }
    if ((value.split(".")[1]?.length ?? 0) > 2) {
      ctx.addIssue({ code: "custom", message: "Due now % has too many decimals" });
      return;
    }
    const n = new D(value);
    if (n.lessThanOrEqualTo(0) || n.greaterThan(100)) {
      ctx.addIssue({ code: "custom", message: "Due now % must be between 0 and 100 (leave blank for full amount)" });
    }
  });

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
    /**
     * Optional staged billing percent (e.g. "40"). Blank/null = full amount due.
     * Shown on the PDF; does not change balance_due until money is recorded.
     */
    dueNowPercent: dueNowPercentField.default(null),
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
    // Advance invoices are themselves deposits — staged % belongs on the final invoice/proforma.
    if (doc.documentType === "advance" && doc.dueNowPercent != null) {
      ctx.addIssue({
        code: "custom",
        path: ["dueNowPercent"],
        message: "Payment schedule % is not used on advance invoices",
      });
    }
  });

/** What the browser sends (strings typed by the user). */
export type DocumentInputRaw = z.input<typeof documentInputSchema>;
/** Parsed + normalized (decimals as plain strings, empty text as null). */
export type DocumentInput = z.output<typeof documentInputSchema>;
export type DocumentLineInput = z.output<typeof documentLineSchema>;
