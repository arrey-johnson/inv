import { z } from "zod";
import type { Repository } from "@/lib/data/types";
import { ServiceError, need, toServiceError, type Actor } from "@/lib/documents/service-support";
import { CURRENCY_CODES, roundMoney } from "@/lib/finance/money";
import { formatMoney } from "@/lib/finance/format";
import { isValidISODate, todayISO } from "@/lib/utils/date-math";
import { PAYMENT_METHODS, type DocumentRow, type Payment } from "@/types/database";
import { checkPaymentAllocations, type PayableDocument } from "./settlement";

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const PROOF_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const paymentInputSchema = z.object({
  customerId: z.string().uuid("Choose a customer."),
  paymentDate: z.string().refine(isValidISODate, "Enter a valid payment date."),
  amount: z.coerce.number({ message: "Enter the amount received." }).positive("The amount must be greater than zero."),
  currency: z.enum(CURRENCY_CODES),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120, "Reference is too long.").optional().nullable(),
  notes: z.string().trim().max(1000, "Notes are too long.").optional().nullable(),
  allocations: z
    .array(
      z.object({
        documentId: z.string().uuid(),
        amount: z.coerce.number().positive("Enter an amount greater than zero."),
      }),
    )
    .min(1, "Select at least one invoice to apply this payment to."),
  isAdjustment: z.boolean().default(false),
  adjustmentReason: z.string().trim().max(500).optional().nullable(),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export interface PaymentProof {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** Validate an uploaded proof of payment (type + size). Returns an error message or null. */
export function checkProof(proof: Pick<PaymentProof, "mimeType" | "bytes">): string | null {
  if (!(PROOF_MIME_TYPES as readonly string[]).includes(proof.mimeType)) {
    return "The proof of payment must be a PDF, PNG, JPG or WEBP file.";
  }
  if (proof.bytes.byteLength === 0) return "The proof of payment file is empty.";
  if (proof.bytes.byteLength > PROOF_MAX_BYTES) return "The proof of payment is too large (maximum 5 MB).";
  return null;
}

export function allocationError(errors: string[]): ServiceError {
  return errors.length === 1
    ? new ServiceError(errors[0]!, "invalid")
    : new ServiceError("This payment cannot be recorded.", "invalid", errors);
}

export interface RecordPaymentResult {
  payment: Payment;
  documents: DocumentRow[];
}

/**
 * Record a payment against one or several invoices.
 *
 * Rules enforced here (and again, atomically, by the repository / database):
 *  - the amount must be fully applied; an invoice can never receive more than its balance (overpayment is refused);
 *  - the payment date cannot be in the future;
 *  - an invoice is only ever PAID through a payment record. The single exception is an administrator
 *    adjustment (`isAdjustment`), which needs the `payments.adjust` permission and a written reason, is flagged
 *    on the payment and is audited under its own action.
 */
export async function recordPayment(
  repo: Repository,
  actor: Actor,
  rawInput: unknown,
  proof?: PaymentProof | null,
  today: string = todayISO(),
): Promise<RecordPaymentResult> {
  try {
    need(actor, "payments.create");
    const parsed = paymentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid payment.", "invalid");
    }
    const input = parsed.data;

    if (input.paymentDate > today) throw new ServiceError("The payment date cannot be in the future.", "invalid");

    if (input.isAdjustment) {
      need(actor, "payments.adjust", "Only an administrator can record a settlement adjustment.");
      if (!input.adjustmentReason || input.adjustmentReason.length < 10) {
        throw new ServiceError("Explain the adjustment (at least 10 characters). It is recorded in the audit trail.", "invalid");
      }
    }
    if (proof) {
      const problem = checkProof(proof);
      if (problem) throw new ServiceError(problem, "invalid");
    }

    const customer = await repo.customers.get(input.customerId);
    if (!customer) throw new ServiceError("The customer could not be found.", "not_found");

    const documents = new Map<string, PayableDocument>();
    for (const allocation of input.allocations) {
      const bundle = await repo.documents.get(allocation.documentId);
      if (bundle) documents.set(bundle.document.id, bundle.document as PayableDocument);
    }
    const errors = checkPaymentAllocations({
      amount: input.amount,
      currency: input.currency,
      customerId: input.customerId,
      allocations: input.allocations,
      documents,
    });
    if (errors.length > 0) throw allocationError(errors);

    const amount = roundMoney(input.amount, input.currency).toNumber();
    const result = await repo.payments.record({
      customer_id: input.customerId,
      payment_date: input.paymentDate,
      amount,
      currency: input.currency,
      method: input.isAdjustment ? "other" : input.method,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      is_adjustment: input.isAdjustment,
      adjustment_reason: input.isAdjustment ? input.adjustmentReason!.trim() : null,
      allocations: input.allocations.map((a) => ({
        document_id: a.documentId,
        amount: roundMoney(a.amount, input.currency).toNumber(),
      })),
    });

    await repo.writeAudit({
      action: input.isAdjustment ? "payment.adjust" : "payment.create",
      entityType: "payment",
      entityId: result.payment.id,
      metadata: {
        amount,
        currency: input.currency,
        method: result.payment.method,
        customer_id: input.customerId,
        reference: result.payment.reference,
        reason: result.payment.adjustment_reason,
      },
    });
    for (const doc of result.documents) {
      const applied = input.allocations.find((a) => a.documentId === doc.id);
      await repo.writeAudit({
        action: "payment.allocate",
        entityType: "document",
        entityId: doc.id,
        metadata: {
          payment_id: result.payment.id,
          number: doc.number,
          applied: applied ? roundMoney(applied.amount, input.currency).toNumber() : null,
          paid_amount: doc.paid_amount,
          balance_due: doc.balance_due,
          status: doc.status,
          adjustment: input.isAdjustment,
          summary: `${formatMoney(applied?.amount ?? 0, input.currency)} received (${result.payment.method.replace(/_/g, " ")})`,
        },
      });
    }

    if (proof) {
      try {
        await repo.attachments.add({
          entityType: "payment",
          entityId: result.payment.id,
          fileName: proof.fileName,
          mimeType: proof.mimeType,
          bytes: proof.bytes,
        });
      } catch (cause) {
        // The payment is recorded; only the attachment failed. Tell the user rather than undo money.
        console.error("[payments] proof upload failed", cause);
        throw new ServiceError(
          "The payment was recorded, but the proof of payment could not be stored. Open the payment and upload it again.",
          "conflict",
        );
      }
    }
    return result;
  } catch (cause) {
    throw toServiceError(cause);
  }
}

/**
 * Cancel a payment (kept in the history). The invoices it paid get their balance and status back.
 * Refused when it paid an advance that was already deducted from a final invoice.
 */
export async function voidPayment(repo: Repository, actor: Actor, paymentId: string, reason: string): Promise<RecordPaymentResult> {
  try {
    need(actor, "payments.void");
    const why = reason.trim();
    if (why.length < 5) throw new ServiceError("Give a reason for cancelling this payment (at least 5 characters).", "invalid");

    const detail = await repo.payments.get(paymentId);
    if (!detail) throw new ServiceError("Payment not found.", "not_found");
    if (detail.payment.voided_at) throw new ServiceError("This payment is already cancelled.", "conflict");

    for (const { document } of detail.allocations) {
      if (document?.document_type === "advance") {
        const links = await repo.settlement.advanceLinks({ advanceId: document.id });
        if (links.length > 0) {
          throw new ServiceError(
            `This payment settled advance ${document.number ?? ""}, which has already been deducted from a final invoice. Release the advance first.`,
            "conflict",
          );
        }
      }
    }

    const result = await repo.payments.void(paymentId, why);
    await repo.writeAudit({
      action: "payment.void",
      entityType: "payment",
      entityId: paymentId,
      metadata: { reason: why, amount: detail.payment.amount, currency: detail.payment.currency },
    });
    for (const doc of result.documents) {
      await repo.writeAudit({
        action: "payment.void",
        entityType: "document",
        entityId: doc.id,
        metadata: {
          payment_id: paymentId,
          number: doc.number,
          reason: why,
          paid_amount: doc.paid_amount,
          balance_due: doc.balance_due,
          status: doc.status,
          summary: `Payment of ${formatMoney(detail.payment.amount, detail.payment.currency)} cancelled`,
        },
      });
    }
    return result;
  } catch (cause) {
    throw toServiceError(cause);
  }
}

/** Persist OVERDUE (and clear it again if the data changed). Never throws: it must not break a page load. */
export async function refreshOverdue(repo: Repository, today: string = todayISO()): Promise<void> {
  try {
    await repo.documents.syncOverdue(today);
  } catch (cause) {
    console.error("[overdue] could not refresh overdue invoices", cause);
  }
}
