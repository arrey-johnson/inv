import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { CUSTOMER_TYPES } from "@/types/database";
import { optionalEmail, optionalInt, optionalText, requiredText } from "./common";

export const customerSchema = z.object({
  customer_type: z.enum(CUSTOMER_TYPES),
  name: requiredText("Name"),
  code: optionalText(40),
  contact_name: optionalText(255),
  email: optionalEmail,
  phone: optionalText(40),
  address_line1: optionalText(),
  address_line2: optionalText(),
  city: optionalText(100),
  region: optionalText(100),
  country: requiredText("Country", 100),
  /** Legal identifiers are free text supplied by the customer - never generated. */
  niu: optionalText(64),
  rccm: optionalText(64),
  default_currency: z.enum(CURRENCY_CODES),
  payment_terms_days: optionalInt("Payment terms", 0, 365),
  notes: optionalText(2000),
  is_active: z.boolean(),
});

export type CustomerFormValues = z.input<typeof customerSchema>;
export type CustomerValues = z.output<typeof customerSchema>;

/** Blank form (kept out of the client component so server pages can import it). */
export const EMPTY_CUSTOMER: CustomerFormValues = {
  customer_type: "company",
  name: "",
  code: "",
  contact_name: "",
  email: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
  country: "Cameroon",
  niu: "",
  rccm: "",
  default_currency: "XAF",
  payment_terms_days: "",
  notes: "",
  is_active: true,
};
