import { RepositoryError } from "@/lib/data/types";

interface PostgrestLikeError {
  message: string;
  code?: string;
}

/** Translate a PostgREST/Postgres error into the repository error vocabulary. */
export function toRepositoryError(error: PostgrestLikeError, what: string): RepositoryError {
  switch (error.code) {
    case "23505":
      return new RepositoryError(`${what}: a record with the same unique value already exists.`, "conflict");
    case "P0002":
    case "PGRST116":
      return new RepositoryError(`${what}: not found.`, "not_found");
    case "55000":
      return new RepositoryError(error.message, "immutable");
    case "42501":
      return new RepositoryError(`${what}: you do not have permission.`, "forbidden");
    case "23514":
      return new RepositoryError(error.message, "invalid");
    default:
      return new RepositoryError(`${what}: ${error.message}`, "invalid");
  }
}

export function unwrap<T>(result: { data: T; error: PostgrestLikeError | null }, what: string): NonNullable<T> {
  if (result.error) throw toRepositoryError(result.error, what);
  if (result.data === null || result.data === undefined) throw new RepositoryError(`${what}: not found.`, "not_found");
  return result.data as NonNullable<T>;
}

/** Drop `undefined` values so partial updates never overwrite columns with NULL. */
export function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Remove characters that have a meaning inside a PostgREST `or()` filter. */
export function searchTerm(q: string | undefined): string | null {
  const cleaned = (q ?? "").replace(/[,()%*\\"'`:]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function rangeFor(page = 1, pageSize = 20): { from: number; to: number; page: number; pageSize: number } {
  const safePage = Math.max(1, Math.floor(page));
  const size = Math.min(200, Math.max(1, Math.floor(pageSize)));
  const from = (safePage - 1) * size;
  return { from, to: from + size - 1, page: safePage, pageSize: size };
}
