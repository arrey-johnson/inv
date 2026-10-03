import {
  CURRENCY_DECIMALS,
  DEFAULT_CURRENCY,
  roundMoney,
  toDecimal,
  type CurrencyCode,
  type DecimalInput,
} from "./money";

const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  XAF: "FCFA",
  EUR: "EUR",
  USD: "USD",
};

/** Short printable label for a currency (`XAF` -> `FCFA`). */
export function currencyLabel(currency: CurrencyCode): string {
  return CURRENCY_LABEL[currency];
}

/** Insert thousands separators into an integer-part string (locale independent / deterministic). */
function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a number with thousands separators and the currency's fixed decimals, no unit.
 * `1000000` -> `"1,000,000"`; `1234.5` (EUR) -> `"1,234.50"`.
 * Deterministic (does not depend on the runtime ICU locale) so server and PDF output match.
 */
export function formatNumber(
  value: DecimalInput | null | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const rounded = roundMoney(toDecimal(value), currency);
  const decimals = CURRENCY_DECIMALS[currency];
  const negative = rounded.isNegative() && !rounded.isZero();
  const fixed = rounded.abs().toFixed(decimals);
  const [integerPart, fractionPart] = fixed.split(".");
  const body =
    groupThousands(integerPart) + (fractionPart ? `.${fractionPart}` : "");
  return negative ? `-${body}` : body;
}

/**
 * Format money with the currency unit suffix.
 * XAF: `"1,000,000 FCFA"`. Other currencies use the same suffix style: `"1,234.50 EUR"`.
 */
export function formatMoney(
  value: DecimalInput | null | undefined,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  return `${formatNumber(value, currency)} ${CURRENCY_LABEL[currency]}`;
}

/** Shorthand for XAF. `formatXAF(1000000)` -> `"1,000,000 FCFA"`. */
export function formatXAF(value: DecimalInput | null | undefined): string {
  return formatMoney(value, "XAF");
}

/** Format a percentage rate: `19.25` -> `"19.25%"`, `0` -> `"0%"`, `5` -> `"5%"`. */
export function formatPercent(value: DecimalInput | null | undefined): string {
  const dec = toDecimal(value);
  // strip trailing zeros but keep up to 4 decimals
  const text = dec.toDecimalPlaces(4).toFixed();
  return `${text}%`;
}

/** Quantities may be fractional (e.g. 1.5 hours). Show up to 4 decimals without trailing zeros. */
export function formatQuantity(value: DecimalInput | null | undefined): string {
  const dec = toDecimal(value).toDecimalPlaces(4);
  const [intPart, frac] = dec.abs().toFixed().split(".");
  const sign = dec.isNegative() && !dec.isZero() ? "-" : "";
  return `${sign}${groupThousands(intPart)}${frac ? `.${frac}` : ""}`;
}
