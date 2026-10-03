import type { Metadata } from "next";
import { Download, FileText, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { resolvePublicDocument } from "@/lib/auth/public-link";
import { writePublicAudit } from "@/lib/auth/public-access";
import { formatMoney } from "@/lib/finance/format";
import { formatDate } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

// Never index or leak the link through the Referer header.
export const metadata: Metadata = {
  title: "Document",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const TYPE_LABELS = {
  invoice: "Invoice",
  proforma: "Proforma invoice",
  credit_note: "Credit note",
  receipt: "Payment receipt",
  advance: "Advance receipt",
} as const;

function Unavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center space-y-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
            <ShieldX className="size-6" aria-hidden />
          </span>
          <CardTitle>Link unavailable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This document link is invalid, has expired or was withdrawn. Please contact Promptstack Technologies for a
          new link.
        </CardContent>
      </Card>
    </main>
  );
}

export default async function PublicDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolvePublicDocument(token);

  // Same screen for every failure reason: do not reveal whether a token ever existed.
  if (!result.ok) return <Unavailable />;
  const { document } = result;

  await writePublicAudit(document, "document.view_public");

  const customerName =
    document.customer_snapshot && typeof document.customer_snapshot === "object" && !Array.isArray(document.customer_snapshot)
      ? String((document.customer_snapshot as Record<string, unknown>).name ?? "")
      : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="size-5" aria-hidden />
            </span>
            <div>
              <CardTitle className="text-lg">{TYPE_LABELS[document.document_type]}</CardTitle>
              <p className="font-mono text-sm text-muted-foreground">{document.number}</p>
            </div>
            {document.status === "void" && <Badge variant="destructive" className="ml-auto">Void</Badge>}
            {document.status === "paid" && <Badge className="ml-auto bg-success-soft text-success hover:bg-success-soft">Paid</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            {customerName && (
              <>
                <dt className="text-muted-foreground">Billed to</dt>
                <dd className="font-medium">{customerName}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Issue date</dt>
            <dd>{formatDate(document.issue_date)}</dd>
            {document.due_date && document.document_type === "invoice" && (
              <>
                <dt className="text-muted-foreground">Due date</dt>
                <dd>{formatDate(document.due_date)}</dd>
              </>
            )}
          </dl>
          <Separator />
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total (incl. VAT)</span>
            <span className="text-xl font-semibold tabular-nums">{formatMoney(document.total_ttc, document.currency)}</span>
          </div>
          {document.document_type === "invoice" && document.balance_due > 0 && (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Balance due</span>
              <span className="font-semibold tabular-nums">{formatMoney(document.balance_due, document.currency)}</span>
            </div>
          )}
          <Button asChild className="h-10 w-full">
            <a href={`/document/${token}/pdf`} download>
              <Download className="size-4" /> Download PDF
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
