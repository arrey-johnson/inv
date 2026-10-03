/**
 * English amount-in-words for documents. XAF has no minor unit, so the amount is
 * rounded to a whole franc first.
 *
 *   1,250,000 -> "One Million Two Hundred Fifty Thousand Central African CFA Francs Only"
 */
import { roundXAF, toDecimal, type DecimalInput } from "./money";

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
] as const;

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
] as const;

const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"] as const;

/** 0-999 as words (empty string for 0). */
function belowThousand(num: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(num / 100);
  const rest = num % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const ten = TENS[Math.floor(rest / 10)];
      const one = rest % 10;
      parts.push(one ? `${ten}-${ONES[one]}` : ten);
    }
  }
  return parts.join(" ");
}

/** Convert a non-negative safe integer to English words (Title Case). */
export function integerToWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`integerToWords expects a non-negative safe integer, got ${value}`);
  }
  if (value === 0) return ONES[0];

  const groups: string[] = [];
  let remaining = value;
  let scaleIndex = 0;
  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const scale = SCALES[scaleIndex];
      groups.unshift(scale ? `${belowThousand(chunk)} ${scale}` : belowThousand(chunk));
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }
  return groups.join(" ");
}

/** Full sentence for a XAF amount: "... Central African CFA Francs Only". */
export function amountInWordsXAF(value: DecimalInput): string {
  const rounded = roundXAF(toDecimal(value));
  const negative = rounded.isNegative() && !rounded.isZero();
  const whole = rounded.abs().toNumber();
  const words = integerToWords(whole);
  const unit = whole === 1 ? "Central African CFA Franc" : "Central African CFA Francs";
  return `${negative ? "Minus " : ""}${words} ${unit} Only`;
}
