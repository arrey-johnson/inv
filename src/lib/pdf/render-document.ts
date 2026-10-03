import "server-only";
import { buildIssuerSnapshot } from "@/lib/documents/snapshots";
import { isReceivableType } from "@/lib/documents/status";
import { formatMoney } from "@/lib/finance/format";
import type { Repository } from "@/lib/data/types";
import { loadBrandingAssets } from "@/lib/storage/branding";
import type { DocumentRow } from "@/types/database";
import { renderDocumentPdf } from "./document-pdf-renderer";
import { bankFromSnapshot, buildPdfDocumentData, partyFromSnapshot } from "./map-document";

export class DocumentPdfError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 500 = 500,
  ) {
    super(message);
    this.name = "DocumentPdfError";
  }
}

export interface RenderedDocumentPdf {
  bytes: Uint8Array;
  filename: string;
  document: DocumentRow;
}

/**
 * Render any document the repository can see.
 *
 *  - ISSUED documents print their frozen customer/issuer snapshots and the stamp. The PDF
 *    creation date is the issue timestamp, so re-rendering yields byte-identical output and the
 *    SHA-256 stored at issue time can be verified later.
 *  - DRAFTS print live data with a DRAFT watermark and never a stamp.
 */
export async function renderRepositoryDocumentPdf(repo: Repository, documentId: string): Promise<RenderedDocumentPdf> {
  const bundle = await repo.documents.get(documentId);
  if (!bundle) throw new DocumentPdfError("Document not found", 404);
  const { document, items, withholdings, customer } = bundle;

  const [organization, settings, destinations] = await Promise.all([
    repo.organization.get(),
    repo.organization.getSettings(),
    repo.paymentDestinations.list(),
  ]);
  if (!organization) throw new DocumentPdfError("Organization not found", 404);

  const frozen = document.status !== "draft" && document.customer_snapshot && document.issuer_snapshot;
  const issuerSnapshot = frozen ? document.issuer_snapshot : buildIssuerSnapshot(organization, settings, destinations);
  const customerSnapshot = frozen ? document.customer_snapshot : customer ? { ...customer } : null;

  // Receivables print what has been deducted: advances already invoiced and paid, credit notes, payments.
  const metaRows: Array<{ label: string; value: string }> = [];
  const settlementRows: Array<{ label: string; amount: number }> = [];
  if (isReceivableType(document.document_type) && document.status !== "draft" && document.status !== "void") {
    const links = await repo.settlement.advanceLinks({ invoiceId: document.id });
    for (const link of links) {
      const advance = await repo.documents.get(link.advance_document_id);
      const label = advance?.document.number ?? "advance";
      settlementRows.push({ label: `Less advance ${label}`, amount: link.amount });
      metaRows.push({
        label: "Previous advance",
        value: `${label}: ${formatMoney(link.amount, document.currency)} (VAT ${formatMoney(link.vat_amount, document.currency)} already declared on the advance)`,
      });
    }
    if (document.credited_amount > 0) settlementRows.push({ label: "Credit notes", amount: document.credited_amount });
    if (document.paid_amount > 0) settlementRows.push({ label: "Payments received", amount: document.paid_amount });
  }

  const data = buildPdfDocumentData({
    metaRows,
    settlementRows,
    document,
    items,
    withholdings,
    customer: partyFromSnapshot(customerSnapshot, "Customer"),
    issuer: partyFromSnapshot(issuerSnapshot, "Promptstack Technologies"),
    bank: bankFromSnapshot(issuerSnapshot),
    issuerSnapshot,
    verificationUrl: null,
  });

  const branding = await loadBrandingAssets(document.organization_id);
  const bytes = await renderDocumentPdf(
    data,
    { letterheadPdf: branding.letterheadPdf, stampPng: branding.stampPng },
    {
      // Admin can switch the stamp off entirely; otherwise the status decides (never on drafts/void).
      applyStamp: settings && settings.stamp_enabled === false ? false : undefined,
      stampLayout: settings ? { x: settings.stamp_x, y: settings.stamp_y, width: settings.stamp_width } : null,
      now: document.issued_at ? new Date(document.issued_at) : new Date(),
    },
  );

  const safeNumber = (document.number ?? `draft-${document.id.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, "_");
  return { bytes, filename: `${safeNumber}.pdf`, document };
}
