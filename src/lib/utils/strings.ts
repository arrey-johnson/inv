export function getInitials(name: string | null | undefined, max = 2): string {
  if (!name) return "?";
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, max)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Exhaustiveness helper for switch statements over unions / enums. */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
