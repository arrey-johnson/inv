import { isValidISODate } from "@/lib/utils/date-math";

export const RANGE_PRESETS = ["this_month", "last_month", "quarter", "year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom",
};

export interface DateRange {
  preset: RangePreset;
  /** Inclusive yyyy-MM-dd bounds. */
  from: string;
  to: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Days in a month (month is 1-12). */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: iso(year, month, 1), to: iso(year, month, daysIn(year, month)) };
}

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value);
}

/**
 * Turn a preset (and, for `custom`, the user's dates) into inclusive bounds relative to `today`.
 * An invalid or reversed custom range falls back to the current month so a page never breaks on bad input.
 */
export function resolveDateRange(
  preset: RangePreset,
  today: string,
  custom: { from?: string | null; to?: string | null } = {},
): DateRange {
  const [year, month] = today.split("-").map(Number) as [number, number];

  if (preset === "custom") {
    const { from, to } = custom;
    if (from && to && isValidISODate(from) && isValidISODate(to) && from <= to) {
      return { preset, from, to, label: `${from} to ${to}` };
    }
    return resolveDateRange("this_month", today);
  }

  if (preset === "last_month") {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return { preset, ...monthRange(prevYear, prevMonth), label: RANGE_PRESET_LABELS[preset] };
  }
  if (preset === "quarter") {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return {
      preset,
      from: iso(year, startMonth, 1),
      to: iso(year, startMonth + 2, daysIn(year, startMonth + 2)),
      label: RANGE_PRESET_LABELS[preset],
    };
  }
  if (preset === "year") {
    return { preset, from: iso(year, 1, 1), to: iso(year, 12, 31), label: RANGE_PRESET_LABELS[preset] };
  }
  return { preset: "this_month", ...monthRange(year, month), label: RANGE_PRESET_LABELS.this_month };
}

/** The `yyyy-MM` keys of every month overlapping a range (for the monthly sales chart). */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [endY, endM] = to.split("-").map(Number) as [number, number];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
}

export function inRange(date: string | null | undefined, range: { from: string; to: string }): boolean {
  return Boolean(date) && date! >= range.from && date! <= range.to;
}
