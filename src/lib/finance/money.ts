/**
 * Money primitives for the invoicing engine.
 *
 * Rules:
 *  - NEVER use native JS floats for money arithmetic. Everything goes through Decimal.js.
 *  - XAF (Central African CFA franc) has no minor unit: every monetary amount is rounded
 *    to the nearest whole franc, with halves rounded away from zero (ROUND_HALF_UP).
 *  - EUR / USD are supported for future use and round to 2 decimals.
 */
import Decimal from "decimal.js";

/** An isolated Decimal constructor so we never mutate global Decimal config used by other libs. */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Dec = InstanceType<typeof D>;
export type DecimalInput = Decimal.Value;

export const CURRENCY_CODES = ["XAF", "EUR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export const DEFAULT_CURRENCY: CurrencyCode = "XAF";

/** Number of minor-unit decimals kept for each currency. */
export const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  XAF: 0,
  EUR: 2,
  USD: 2,
};

export const ZERO: Dec = new D(0);
export const HUNDRED: Dec = new D(100);

/** Coerce anything numeric-ish into a Decimal. `null`/`undefined`/"" become 0. */
export function toDecimal(value: DecimalInput | null | undefined): Dec {
  if (value === null || value === undefined || value === "") return new D(0);
  if (value instanceof D) return value;
  const decimal = new D(value as Decimal.Value);
  if (!decimal.isFinite()) {
    throw new RangeError(`Invalid monetary value: ${String(value)}`);
  }
  return decimal;
}

/** Round a value to the precision of the given currency (half up). */
export function roundMoney(
  value: DecimalInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Dec {
  return toDecimal(value).toDecimalPlaces(
    CURRENCY_DECIMALS[currency],
    D.ROUND_HALF_UP,
  );
}

/** Round to the nearest whole franc (XAF). */
export function roundXAF(value: DecimalInput): Dec {
  return roundMoney(value, "XAF");
}

/** Convert to a JS number AFTER rounding. Use only at API/DB boundaries. */
export function moneyToNumber(
  value: DecimalInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): number {
  return roundMoney(value, currency).toNumber();
}

export function sumDecimals(values: ReadonlyArray<DecimalInput>): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(toDecimal(v)), new D(0));
}

/** `base * percent / 100` (unrounded). */
export function percentOf(base: DecimalInput, percent: DecimalInput): Dec {
  return toDecimal(base).times(toDecimal(percent)).dividedBy(HUNDRED);
}

export function clampDecimal(
  value: DecimalInput,
  min: DecimalInput,
  max: DecimalInput,
): Dec {
  return minOfDecimals(maxOfDecimals(toDecimal(value), toDecimal(min)), toDecimal(max));
}

export function minOfDecimals(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}
export function maxOfDecimals(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

/**
 * Split `total` across `weights` so that the parts sum EXACTLY to `total`
 * (largest-remainder method) at the currency's precision.
 *
 * Used for allocating a global discount across lines, distributing tax of a rate-group
 * back onto its lines, and spreading payments across documents.
 *
 * If every weight is zero the result is all zeros (nothing can be allocated).
 * Ties are broken by lowest index so the output is deterministic.
 */
export function allocateProportionally(
  total: DecimalInput,
  weights: ReadonlyArray<DecimalInput>,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Dec[] {
  const decimals = CURRENCY_DECIMALS[currency];
  const unit = new D(10).pow(-decimals); // smallest unit (1 for XAF, 0.01 for EUR)
  const totalDec = roundMoney(total, currency);
  const weightDecs = weights.map((w) => toDecimal(w));
  const weightSum = sumDecimals(weightDecs);

  if (totalDec.isNegative()) {
    throw new RangeError("Cannot allocate a negative total");
  }
  if (weightDecs.length === 0) return [];
  if (weightSum.isZero() || totalDec.isZero()) {
    return weightDecs.map(() => new D(0));
  }
  if (weightDecs.some((w) => w.isNegative())) {
    throw new RangeError("Allocation weights must be non-negative");
  }

  const exact = weightDecs.map((w) => totalDec.times(w).dividedBy(weightSum));
  const floors = exact.map((x) => x.toDecimalPlaces(decimals, D.ROUND_FLOOR));
  let remainder = totalDec.minus(sumDecimals(floors));

  const order = exact
    .map((x, index) => ({ index, fraction: x.minus(floors[index]) }))
    .sort((a, b) => {
      const cmp = b.fraction.comparedTo(a.fraction);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const result = floors.slice();
  for (const { index } of order) {
    if (remainder.lessThanOrEqualTo(0)) break;
    result[index] = result[index].plus(unit);
    remainder = remainder.minus(unit);
  }
  return result;
}
