import "server-only";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments/payment-method-labels";
import type { PaymentDetail, Repository } from "@/lib/data/types";
import { buildIssuerSnapshot } from "@/lib/documents/snapshots";
import { ServiceError } from "@/lib/documents/service-support";
import { calculateDocument } from "@/lib/finance/calculate-document";
import { renderDocumentPdf } from "@/lib/pdf/document-pdf-renderer";
import { partyFromSnapshot, signatoryFromSnapshot } from "@/lib/pdf/map-document";
import type { PdfDocumentData, PdfLine } from "@/lib/pdf/types";
import { loadBrandingAssets } from "@/lib/storage/branding";
import type { Customer, Payment } from "@/types/database";

/** Official receipt number shown on the PDF (not a documents-table sequence yet). */
export function paymentReceiptNumber(payment: Pick<Payment, "id" | "payment_date">): string {
  const yyyy = payment.payment_date.slice(0, 4);
  const short = payment.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PS-RCP-${yyyy}-${short}`;
}

function customerToParty(customer: Customer | null): PdfDocumentData["customer"] {
  if (!customer) return { name: "Customer" };
  return partyFromSnapshot(
    {
      name: customer.name,
      legal_name: customer.name,
      address_line1: customer.address_line1,
      address_line2: customer.address_line2,
      city: customer.city,
      region: customer.region,
      country: customer.country,
      niu: customer.niu,
      rccm: customer.rccm,
      phone: customer.phone,
      email: customer.email,
    },
    customer.name,
  );
}

/** Pure mapping: payment + allocations → renderer input (letterhead/stamp via status). */
export function buildPaymentReceiptPdfData(
  detail: PaymentDetail,
  issuer: PdfDocumentData["issuer"],
  options?: { signatory?: PdfDocumentData["signatory"] },
): PdfDocumentData {
  const { payment, customer, allocations } = detail;
  const voided = payment.voided_at !== null;

  const lines: PdfLine[] =
    allocations.length > 0
      ? allocations.map(({ allocation, document }) => {
          const invoiceNo = document?.number ?? "Invoice";
          return {
            description: `Payment applied to ${invoiceNo}`,
            details: document?.subject ?? null,
            quantity: 1,
            unit: null,
            unitPrice: allocation.amount,
            discountLabel: null,
            taxRate: 0,
            netAmount: allocation.amount,
          };
        })
      : [
          {
            description: "Payment received",
            details: payment.notes,
            quantity: 1,
            unit: null,
            unitPrice: payment.amount,
            discountLabel: null,
            taxRate: 0,
            netAmount: payment.amount,
          },
        ];

  const calc = calculateDocument({
    currency: payment.currency,
    lines: lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: 0,
    })),
  });

  const metaRows: Array<{ label: string; value: string }> = [
    { label: "Payment method", value: PAYMENT_METHOD_LABELS[payment.method] },
  ];
  if (payment.reference?.trim()) {
    metaRows.push({ label: "Reference", value: payment.reference.trim() });
  }
  if (payment.is_adjustment) {
    metaRows.push({
      label: "Note",
      value: payment.adjustment_reason?.trim() || "Administrator adjustment (not a cash receipt)",
    });
  }
  if (voided && payment.void_reason) {
    metaRows.push({ label: "Cancelled", value: payment.void_reason });
  }

  return {
    type: "receipt",
    status: voided ? "void" : "issued",
    number: paymentReceiptNumber(payment),
    issueDate: payment.payment_date,
    dueDate: null,
    currency: payment.currency,
    issuer,
    customer: customerToParty(customer),
    metaRows,
    lines,
    calc,
    settlement: null,
    notes: payment.notes,
    terms: null,
    bank: null,
    paymentInstructions: null,
    signatory: options?.signatory ?? null,
    verificationUrl: null,
  };
}

export async function renderPaymentReceiptPdf(
  repo: Repository,
  paymentId: string,
): Promise<{ bytes: Uint8Array; filename: string; detail: PaymentDetail }> {
  const detail = await repo.payments.get(paymentId);
  if (!detail) throw new ServiceError("Payment not found.", "not_found");

  const [organization, settings, destinations] = await Promise.all([
    repo.organization.get(),
    repo.organization.getSettings(),
    repo.paymentDestinations.list(),
  ]);
  if (!organization) throw new ServiceError("Organization not found.", "not_found");

  const issuerSnapshot = buildIssuerSnapshot(organization, settings, destinations);
  const issuer = partyFromSnapshot(issuerSnapshot, "Promptstack Technologies");
  const data = buildPaymentReceiptPdfData(detail, issuer, {
    signatory: signatoryFromSnapshot(issuerSnapshot),
  });
  const branding = await loadBrandingAssets(organization.id);
  const bytes = await renderDocumentPdf(
    data,
    { letterheadPdf: branding.letterheadPdf, stampPng: branding.stampPng },
    {
      applyStamp: settings && settings.stamp_enabled === false ? false : undefined,
      stampLayout: settings ? { x: settings.stamp_x, y: settings.stamp_y, width: settings.stamp_width } : null,
      now: new Date(detail.payment.created_at),
    },
  );

  const filename = `${paymentReceiptNumber(detail.payment)}.pdf`;
  return { bytes, filename, detail };
}
