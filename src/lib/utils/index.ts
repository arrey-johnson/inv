import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names. This is the `cn` helper expected by shadcn/ui
 * (`@/lib/utils`). The `utils/` folder is used instead of a single `utils.ts`
 * so more helpers can live next to it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { formatDate, formatDateTime, toISODate } from "./dates";
export { getInitials, slugify, assertNever } from "./strings";
