import { z } from "zod";

/** Trim; empty string becomes null so optional DB columns stay NULL instead of ''. */
const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const optionalEmail = z
  .string()
  .trim()
  .max(255)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address");

const optionalUrl = z
  .string()
  .trim()
  .max(255)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.string().url().safeParse(v).success, "Enter a full URL, e.g. https://example.com");

/**
 * Company profile. NIU and RCCM are free text on purpose: they are legal identifiers supplied by the
 * company and are never generated or defaulted by the system.
 */
export const companyProfileSchema = z.object({
  legal_name: z.string().trim().min(2, "Legal name is required").max(255),
  trade_name: optionalText(),
  niu: optionalText(64),
  rccm: optionalText(64),
  address_line1: optionalText(),
  address_line2: optionalText(),
  city: optionalText(100),
  region: optionalText(100),
  country: z.string().trim().min(2, "Country is required").max(100),
  phone: optionalText(40),
  email: optionalEmail,
  website: optionalUrl,
});

/** Shape the form edits (all strings). */
export type CompanyProfileFormValues = z.input<typeof companyProfileSchema>;
/** Shape written to the database. */
export type CompanyProfileValues = z.output<typeof companyProfileSchema>;
