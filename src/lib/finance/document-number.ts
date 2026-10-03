/**
 * Mirror of the number format built by `allocate_document_number()` in SQL
 * (supabase/migrations/00007_functions.sql). Used for previews in the UI only - the database is
 * always the authority when a number is actually allocated.
 *
 *   prefix + [separator + year] + separator + zero-padded counter  ->  PS-INV-2026-0001
 */
export interface NumberFormatConfig {
  prefix: string;
  separator: string;
  include_year: boolean;
  padding: number;
}

export function formatDocumentNumber(config: NumberFormatConfig, year: number, counter: number): string {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError(`Invalid counter: ${counter}`);
  }
  const digits = String(counter).padStart(config.padding, "0"); // never truncates, like the SQL guard
  return (
    config.prefix +
    (config.include_year ? `${config.separator}${year}` : "") +
    config.separator +
    digits
  );
}
