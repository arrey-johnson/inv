"use server";

import {
  applyAdvanceOp,
  createCreditNoteOp,
  createLinkOp,
  recordPaymentOp,
  respondProformaOp,
  revokeLinkOp,
  sendEmailOp,
  voidDocumentOp,
  voidPaymentOp,
  type CreditNoteRef,
  type PaymentRef,
  type SendEmailResult,
} from "@/lib/actions/finance-ops";
import type { ActionResult } from "@/lib/actions/helpers";
import type { ProformaResponse } from "@/lib/documents/void-service";

export async function recordPaymentAction(form: FormData): Promise<ActionResult<PaymentRef>> {
  return recordPaymentOp(form);
}

export async function voidPaymentAction(id: string, reason: string): Promise<ActionResult> {
  return voidPaymentOp(id, reason);
}

export async function createCreditNoteAction(input: unknown): Promise<ActionResult<CreditNoteRef>> {
  return createCreditNoteOp(input);
}

export async function applyAdvanceAction(input: unknown): Promise<ActionResult<{ applied: number }>> {
  return applyAdvanceOp(input);
}

export async function voidDocumentAction(id: string, reason: string): Promise<ActionResult<{ pdfError: string | null }>> {
  return voidDocumentOp(id, reason);
}

export async function respondProformaAction(id: string, response: ProformaResponse, note?: string): Promise<ActionResult> {
  return respondProformaOp(id, response, note);
}

export async function sendEmailAction(input: unknown): Promise<ActionResult<SendEmailResult>> {
  return sendEmailOp(input);
}

export async function createLinkAction(id: string, expiresInDays: number | null): Promise<ActionResult<{ url: string; expiresAt: string | null }>> {
  return createLinkOp(id, expiresInDays);
}

export async function revokeLinkAction(id: string): Promise<ActionResult> {
  return revokeLinkOp(id);
}
