import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/** Authenticated download of a payment's proof file. Never public. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attachmentId = request.nextUrl.searchParams.get("attachment");
  if (!idSchema.safeParse(id).success || !attachmentId || !idSchema.safeParse(attachmentId).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role, "payments.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const repo = await getRepositoryFor(ctx);
  const found = await repo.attachments.read(attachmentId);
  if (!found || found.attachment.entity_type !== "payment" || found.attachment.entity_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const safeName = found.attachment.file_name.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(Buffer.from(found.bytes), {
    headers: {
      "Content-Type": found.attachment.mime_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
