import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Builds `?a=1&b=2` from the current filters with a replaced page number. */
function hrefFor(basePath: string, params: Record<string, string>, page: number): string {
  const query = new URLSearchParams(params);
  if (page > 1) query.set("page", String(page));
  else query.delete("page");
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** Link-based pagination: works without JavaScript and keeps the URL shareable. */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkClass = (disabled: boolean) =>
    cn(buttonVariants({ variant: "outline", size: "sm" }), disabled && "pointer-events-none opacity-50");

  return (
    <div className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
      <p>
        {total === 0 ? "No results" : `Showing ${from}-${to} of ${total}`}
      </p>
      <nav className="flex items-center gap-2" aria-label="Pagination">
        <Link
          href={hrefFor(basePath, params, page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={linkClass(page <= 1)}
        >
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </Link>
        <span>
          Page {page} of {pages}
        </span>
        <Link
          href={hrefFor(basePath, params, page + 1)}
          aria-disabled={page >= pages}
          tabIndex={page >= pages ? -1 : undefined}
          className={linkClass(page >= pages)}
        >
          Next <ChevronRight className="size-4" aria-hidden />
        </Link>
      </nav>
    </div>
  );
}
