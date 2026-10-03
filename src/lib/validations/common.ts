import { z } from "zod";
import { D } from "@/lib/finance/money";
import { isValidISODate } from "@/lib/utils/date-math";

/** Trim; empty string becomes null so optional DB columns stay NULL instead of ''. */
export const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const optionalEmail = z
  .string()
  .trim()
  .max(255)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

export const requiredText = (label: string, max = 255) =>
  z.string().trim().min(1, `${label} is required`).max(max, `Must be at most ${max} characters`);

export const uuidField = (message = "Invalid identifier") => z.string().uuid(message);

export const optionalUuid = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Invalid identifier");

interface DecimalOptions {
  /** Value must be strictly greater than zero. */
  positive?: boolean;
  max?: number;
  maxDecimals?: number;
  /** Treat "" as "0" (optional numeric inputs such as discounts). */
  emptyAsZero?: boolean;
}

const DECIMAL_TEXT = /^\d+(\.\d+)?$/;

/** "1 000 000" / "1,5" / 1000 -> "1000000" / "1.5" / "1000". Pure text normalization, no float parsing. */
export function normalizeDecimalText(raw: string | number): string {
  return String(raw).trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
}

/** The normalized text if it is a plain non-negative decimal, otherwise null. */
export function parseDecimalText(raw: string | number | null | undefined): string | null {
  const text = normalizeDecimalText(raw ?? "");
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

/**
 * A decimal typed by a person: accepts "1 000 000", "1,5", 1000. Output is a normalized plain string
 * ("1000000", "1.5") that is handed to Decimal.js - never parsed with parseFloat.
 */
export const decimalString = (label: string, options: DecimalOptions = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((raw) => {
      const text = normalizeDecimalText(raw);
      return text === "" && options.emptyAsZero ? "0" : text;
    })
    .pipe(z.string().regex(/^\d+(\.\d+)?$/, { error: `${label} must be a number`, abort: true }))
    .refine((v) => (v.split(".")[1]?.length ?? 0) <= (options.maxDecimals ?? 4), `${label} has too many decimals`)
    .refine((v) => !options.positive || !DECIMAL_TEXT.test(v) || new D(v).greaterThan(0), `${label} must be greater than zero`)
    .refine((v) => options.max === undefined || !DECIMAL_TEXT.test(v) || new D(v).lessThanOrEqualTo(options.max), `${label} is too large`);

/** Optional whole number typed in a form ("" / null -> null). */
export const optionalInt = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()),
    z
      .string()
      .regex(/^\d+$/, `${label} must be a whole number`)
      .transform(Number)
      .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`)
      .nullable(),
  );

export const requiredInt = (label: string, min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(
      z
        .string()
        .regex(/^\d+$/, `${label} must be a whole number`)
        .transform(Number)
        .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`),
    );

export const isoDate = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a valid date`)
    .refine(isValidISODate, `${label} must be a valid date`);

export const optionalIsoDate = (label: string) =>
  z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isValidISODate(v)), `${label} must be a valid date`);

/** Flatten zod issues into `{ "lines.0.quantity": "message" }` for forms. */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
