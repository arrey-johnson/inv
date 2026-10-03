/**
 * Only allow same-site relative redirects. Prevents open redirects through `?next=` parameters
 * such as `//evil.com`, `/\evil.com` or absolute URLs.
 */
export function safeRedirectPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
