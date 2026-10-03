export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param, trimmed ("" when absent). */
export function param(search: RawSearchParams, key: string): string {
  const value = search[key];
  const text = Array.isArray(value) ? value[0] : value;
  return (text ?? "").trim();
}

/** Positive integer page number (defaults to 1). */
export function pageParam(search: RawSearchParams): number {
  const n = Number.parseInt(param(search, "page"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Only the non-empty params, for rebuilding pagination links. */
export function activeParams(search: RawSearchParams, keys: ReadonlyArray<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = param(search, key);
    if (value) out[key] = value;
  }
  return out;
}

/** Decimal text for amount filters; null when not a plain non-negative number. */
export function amountParam(search: RawSearchParams, key: string): number | null {
  const text = param(search, key).replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}
