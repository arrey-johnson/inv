import { NextResponse, type NextRequest } from "next/server";
import { convertOp, duplicateOp, issueOp } from "@/lib/actions/document-ops";
import type { ActionResult } from "@/lib/actions/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPERATIONS: Record<string, (id: string) => Promise<ActionResult<unknown>>> = {
  issue: issueOp,
  convert: convertOp,
  duplicate: duplicateOp,
};

/**
 * POST /api/documents/:id/issue | convert | duplicate
 *
 * Thin HTTP wrapper over the same domain operations the UI's server actions call, so permissions,
 * approval rules, immutability and number allocation are enforced identically.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const operation = OPERATIONS[action];
  if (!operation) return NextResponse.json({ error: "Unknown action" }, { status: 404 });

  // Same-origin only: this endpoint relies on the session cookie.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }

  const result = await operation(id);
  if (result.ok) return NextResponse.json({ data: result.data });

  const status = /session has expired/i.test(result.error)
    ? 401
    : /permission/i.test(result.error)
      ? 403
      : /not found/i.test(result.error)
        ? 404
        : 409;
  return NextResponse.json({ error: result.error, details: result.details ?? [] }, { status });
}
