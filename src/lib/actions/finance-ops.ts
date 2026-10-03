import "server-only";
import { z } from "zod";
import { applyAdvanceToInvoice } from "@/lib/advances/advance-service";
import { getDocumentLinkSecret } from "@/lib/auth/public-access";
import { createCreditNote } from "@/lib/credit-notes/credit-note-service";
import { createPublicLink, revokePublicLink } from "@/lib/documents/link-service";
import { DOCUMENT_ROUTES, isSalesDocumentType } from "@/lib/documents/status";
import { respondToProforma, voidDocument, type ProformaResponse } from "@/lib/documents/void-service";
import { getEmailProvider } from "@/lib/email/get-provider";
import { sendDocumentEmail } from "@/lib/email/send-document";
import { publicEnv } from "@/lib/env";
import { recordPayment, voidPayment, type PaymentProof } from "@/lib/payments/payment-service";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { authorize, failure, isFailure, revalidateSales, succeed, type ActionResult } from "./helpers";

const deps = { renderPdf: renderRepositoryDocumentPdf };
const uuid = z.string().uuid("Invalid id");

function revalidateFinance() {
  revalidateSales();
}

function hrefFor(doc: { id: string; document_type: string }): string {
  return isSalesDocumentType(doc.document_type as "invoice")
    ? `${DOCUMENT_ROUTES[doc.document_type as "invoice"]}/${doc.id}`
    : `/sales/${doc.id}`;
}

// ---------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------
export interface PaymentRef {
  id: string;
  href: string;
  /** Per invoice: number and what is left to pay after this payment. */
  documents: Array<{ id: string; number: string | null; status: string; balanceDue: number }>;
}

/**
 * Record a payment from a form post: scalar fields, `allocations` as JSON and an optional `proof` file.
 * The browser never decides a balance or a status; the service recomputes everything.
 */
export async function recordPaymentOp(form: FormData): Promise<ActionResult<PaymentRef>> {
  const auth = await authorize("payments.create");
  if (isFailure(auth)) return auth;

  let allocations: unknown = [];
  try {
    allocations = JSON.parse(String(form.get("allocations") ?? "[]"));
  } catch {
    return { ok: false, error: "The invoice selection is invalid. Reload the page and try again." };
  }

  const raw = {
    customerId: form.get("customerId"),
    paymentDate: form.get("paymentDate"),
    amount: form.get("amount"),
    currency: form.get("currency"),
    method: form.get("method"),
    reference: (form.get("reference") as string) || null,
    notes: (form.get("notes") as string) || null,
    allocations,
    isAdjustment: form.get("isAdjustment") === "on" || form.get("isAdjustment") === "true",
    adjustmentReason: (form.get("adjustmentReason") as string) || null,
  };

  let proof: PaymentProof | null = null;
  const file = form.get("proof");
  if (file instanceof File && file.size > 0) {
    proof = { fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  try {
    const result = await recordPayment(auth.repo, { role: auth.ctx.role }, raw, proof);
    revalidateFinance();
    return succeed({
      id: result.payment.id,
      href: `/sales/payments/${result.payment.id}`,
      documents: result.documents.map((d) => ({ id: d.id, number: d.number, status: d.status, balanceDue: d.balance_due })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function voidPaymentOp(id: string, reason: string): Promise<ActionResult> {
  const auth = await authorize("payments.void");
  if (isFailure(auth)) return auth;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid payment id" };
  try {
    await voidPayment(auth.repo, { role: auth.ctx.role }, id, reason);
    revalidateFinance();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------------------------
// Credit notes and advances
// ---------------------------------------------------------------------------------------------
export interface CreditNoteRef {
  id: string;
  number: string | null;
  href: string;
  invoiceHref: string;
  pdfError: string | null;
}

export async function createCreditNoteOp(input: unknown): Promise<ActionResult<CreditNoteRef>> {
  const auth = await authorize("credit_notes.create", "credit_notes.issue");
  if (isFailure(auth)) return auth;
  try {
    const out = await createCreditNote(auth.repo, { role: auth.ctx.role }, input, deps);
    revalidateFinance();
    return succeed({
      id: out.creditNote.id,
      number: out.creditNote.number,
      href: hrefFor(out.creditNote),
      invoiceHref: hrefFor(out.invoice),
      pdfError: out.issue.pdfError,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function applyAdvanceOp(input: unknown): Promise<ActionResult<{ applied: number }>> {
  const auth = await authorize("advances.apply");
  if (isFailure(auth)) return auth;
  try {
    const result = await applyAdvanceToInvoice(auth.repo, { role: auth.ctx.role }, input);
    revalidateFinance();
    return succeed({ applied: result.applied });
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------------------------
// Void, proforma answers
// ---------------------------------------------------------------------------------------------
export async function voidDocumentOp(id: string, reason: string): Promise<ActionResult<{ pdfError: string | null }>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const out = await voidDocument(auth.repo, { role: auth.ctx.role }, id, reason, deps);
    revalidateFinance();
    return succeed({ pdfError: out.pdfError });
  } catch (error) {
    return failure(error);
  }
}

export async function respondProformaOp(id: string, response: ProformaResponse, note?: string | null): Promise<ActionResult> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  if (!["accept", "decline", "expire"].includes(response)) return { ok: false, error: "Unknown answer" };
  try {
    await respondToProforma(auth.repo, { role: auth.ctx.role }, id, response, note);
    revalidateFinance();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------------------------
// Email and public links
// ---------------------------------------------------------------------------------------------
const linkEnv = () => ({ secret: getDocumentLinkSecret(), baseUrl: publicEnv.NEXT_PUBLIC_APP_URL });

export interface SendEmailResult {
  status: "sent" | "queued";
  delivered: boolean;
  provider: string;
  linkUrl: string | null;
}

export async function sendEmailOp(input: unknown): Promise<ActionResult<SendEmailResult>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  try {
    const out = await sendDocumentEmail(auth.repo, { role: auth.ctx.role }, input, {
      provider: getEmailProvider(),
      renderPdf: renderRepositoryDocumentPdf,
      link: linkEnv(),
    });
    revalidateFinance();
    return succeed({
      status: out.log.status === "sent" ? "sent" : "queued",
      delivered: out.delivered,
      provider: out.log.provider ?? "",
      linkUrl: out.linkUrl,
    });
  } catch (error) {
    revalidateFinance();
    return failure(error);
  }
}

export async function createLinkOp(id: string, expiresInDays: number | null): Promise<ActionResult<{ url: string; expiresAt: string | null }>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const link = await createPublicLink(auth.repo, { role: auth.ctx.role }, id, linkEnv(), { expiresInDays });
    revalidateFinance();
    return succeed({ url: link.url, expiresAt: link.expiresAt });
  } catch (error) {
    return failure(error);
  }
}

export async function revokeLinkOp(id: string): Promise<ActionResult> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    await revokePublicLink(auth.repo, { role: auth.ctx.role }, id);
    revalidateFinance();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
