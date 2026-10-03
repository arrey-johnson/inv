import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { isRangePreset, resolveDateRange } from "@/lib/reports/date-range";
import { reportFilename, reportToCsv, reportToXlsx } from "@/lib/reports/export";
import { runReport } from "@/lib/reports/run-report";
import { isReportId } from "@/lib/reports/types";
import { todayISO } from "@/lib/utils/date-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV or Excel export of a report, built from the same data as the on-screen table. Needs `reports.export`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report: id } = await params;
  if (!isReportId(id)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role, "reports.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const query = request.nextUrl.searchParams;
  const format = query.get("format") === "xlsx" ? "xlsx" : "csv";
  const preset = query.get("range");
  const today = todayISO();
  const range = resolveDateRange(isRangePreset(preset) ? preset : "year", today, { from: query.get("from"), to: query.get("to") });
  const currencyParam = query.get("currency") ?? "";
  const currency = (CURRENCY_CODES as readonly string[]).includes(currencyParam) ? (currencyParam as (typeof CURRENCY_CODES)[number]) : undefined;

  try {
    const repo = await getRepositoryFor(ctx);
    const report = await runReport(repo, { id, range, currency, customerId: query.get("customer") || null, today });
    await repo.writeAudit({
      action: "report.export",
      entityType: "report",
      entityId: null,
      metadata: { report: id, format, from: range.from, to: range.to, rows: report.rows.length },
    });

    const filename = reportFilename(report, format);
    const body = format === "xlsx" ? Buffer.from(reportToXlsx(report)) : Buffer.from(reportToCsv(report), "utf8");
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[reports] export failed", error);
    return NextResponse.json({ error: "Could not build the report" }, { status: 500 });
  }
}
