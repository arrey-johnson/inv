import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { ITEM_TYPES } from "@/types/database";
import { decimalString, optionalText, optionalUuid, requiredText } from "./common";

export const itemSchema = z.object({
  item_type: z.enum(ITEM_TYPES),
  sku: optionalText(60),
  name: requiredText("Name"),
  description: optionalText(2000),
  unit: optionalText(30),
  /** Default selling price excluding tax (HT). Kept as text until it reaches Decimal.js. */
  unit_price: decimalString("Price", { maxDecimals: 4, max: 1_000_000_000_000, emptyAsZero: true }),
  currency: z.enum(CURRENCY_CODES),
  tax_rate_id: optionalUuid,
  is_active: z.boolean(),
});

export type ItemFormValues = z.input<typeof itemSchema>;
export type ItemValues = z.output<typeof itemSchema>;

/** Blank form (kept out of the client component so server pages can import it). */
export const EMPTY_ITEM: ItemFormValues = {
  item_type: "service",
  sku: "",
  name: "",
  description: "",
  unit: "",
  unit_price: "",
  currency: "XAF",
  tax_rate_id: null,
  is_active: true,
};
