import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { ServiceError } from "@/lib/documents/service-support";
import { renderPaymentReceiptPdf } from "@/lib/payments/receipt-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/**
 * Authenticated payment receipt PDF (letterhead + stamp).
 * Preview inline by default; `?download=1` forces attachment download.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid payment id" }, { status: 400 });
  }

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role, "payments.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const repo = await getRepositoryFor(ctx);
    const { bytes, filename, detail } = await renderPaymentReceiptPdf(repo, id);

    const download = request.nextUrl.searchParams.get("download") === "1";
    if (download) {
      await repo.writeAudit({
        action: "payment.download_pdf",
        entityType: "payment",
        entityId: detail.payment.id,
        metadata: {
          number: filename.replace(/\.pdf$/i, ""),
          amount: detail.payment.amount,
          currency: detail.payment.currency,
        },
      });
    }

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 });
    }
    console.error("[payment-receipt] render failed", error);
    return NextResponse.json({ error: "Could not generate the receipt PDF" }, { status: 500 });
  }
}
