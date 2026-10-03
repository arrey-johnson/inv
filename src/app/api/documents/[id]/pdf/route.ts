import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { DocumentPdfError, renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import type { DocumentType } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

const VIEW_PERMISSION: Record<DocumentType, Permission> = {
  invoice: "invoices.view",
  proforma: "proformas.view",
  credit_note: "credit_notes.view",
  receipt: "payments.view",
  advance: "invoices.view",
};

/**
 * Authenticated PDF preview (inline) or download (`?download=1`) for the signed-in app.
 * Drafts render with a DRAFT watermark and no stamp; issued documents render from their frozen
 * snapshots with the stamp. Works against Supabase (RLS) or the local demo store.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const repo = await getRepositoryFor(ctx);
    const { bytes, filename, document } = await renderRepositoryDocumentPdf(repo, id);

    if (!hasPermission(ctx.role, VIEW_PERMISSION[document.document_type])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const download = request.nextUrl.searchParams.get("download") === "1";
    if (download) {
      await repo.writeAudit({
        action: "document.download_pdf",
        entityType: "document",
        entityId: document.id,
        metadata: { number: document.number },
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
    if (error instanceof DocumentPdfError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[pdf] render failed", error);
    return NextResponse.json({ error: "Could not generate the PDF" }, { status: 500 });
  }
}
