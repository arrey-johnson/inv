import { format, isValid, parseISO } from "date-fns";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    typeof value === "string" ? parseISO(value) : new Date(value as number | Date);
  return isValid(date) ? date : null;
}

/** Format as `dd MMM yyyy` (e.g. `02 Oct 2026`). Returns an em dash when empty/invalid. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy") : "—";
}

/** Format as `dd MMM yyyy, HH:mm`. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy, HH:mm") : "—";
}

/** Format as ISO calendar date (`yyyy-MM-dd`) in local time – suited to `<input type="date">` and DB `date` columns. */
export function toISODate(value: DateInput): string {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}
