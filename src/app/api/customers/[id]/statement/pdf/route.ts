import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { ServiceError } from "@/lib/documents/service-support";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { renderCustomerStatementPdf } from "@/lib/statements/render-statement";
import { isValidISODate, todayISO } from "@/lib/utils/date-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer statement on the company letterhead (`?from=&to=&currency=`). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid customer id" }, { status: 400 });

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role, "customers.view") || !hasPermission(ctx.role, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = request.nextUrl.searchParams;
  const today = todayISO();
  const to = query.get("to") && isValidISODate(query.get("to")!) ? query.get("to")! : today;
  const from = query.get("from") && isValidISODate(query.get("from")!) ? query.get("from")! : `${to.slice(0, 4)}-01-01`;
  if (from > to) return NextResponse.json({ error: "The start date is after the end date" }, { status: 400 });
  const currencyParam = query.get("currency") ?? "";
  const currency = (CURRENCY_CODES as readonly string[]).includes(currencyParam) ? (currencyParam as (typeof CURRENCY_CODES)[number]) : undefined;

  try {
    const repo = await getRepositoryFor(ctx);
    const pdf = await renderCustomerStatementPdf(repo, id, { from, to }, currency);
    await repo.writeAudit({
      action: "statement.download",
      entityType: "customer",
      entityId: id,
      metadata: { from, to, currency: currency ?? null },
    });
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 });
    }
    console.error("[statement] render failed", error);
    return NextResponse.json({ error: "Could not generate the statement" }, { status: 500 });
  }
}
