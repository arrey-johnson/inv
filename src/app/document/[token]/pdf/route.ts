import { NextResponse, type NextRequest } from "next/server";
import { DocumentPdfError, renderPublicPdf, writePublicAudit } from "@/lib/auth/public-access";
import { resolvePublicDocument } from "@/lib/auth/public-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public PDF download for a valid, unexpired, unrevoked document link. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolvePublicDocument(token);
  if (!result.ok) {
    // Uniform response: don't reveal whether the token exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { bytes, filename, document } = await renderPublicPdf(result.document);
    await writePublicAudit(document, "document.download_pdf", { via: "public_link" });

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if (error instanceof DocumentPdfError && error.status === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[public pdf] render failed", error);
    return NextResponse.json({ error: "Could not generate the PDF" }, { status: 500 });
  }
}
