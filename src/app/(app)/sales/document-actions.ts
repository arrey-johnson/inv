"use server";

import {
  approveOp,
  convertOp,
  deleteDraftOp,
  duplicateOp,
  issueOp,
  rejectOp,
  saveDraftOp,
  submitApprovalOp,
  type ConvertResult,
  type DocumentRef,
  type IssueResult,
} from "@/lib/actions/document-ops";
import type { ActionResult } from "@/lib/actions/helpers";

export async function saveDraftAction(input: unknown, id: string | null): Promise<ActionResult<DocumentRef>> {
  return saveDraftOp(input, id);
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  return deleteDraftOp(id);
}

export async function submitApprovalAction(id: string): Promise<ActionResult<DocumentRef>> {
  return submitApprovalOp(id);
}

export async function approveAction(id: string, note?: string): Promise<ActionResult<DocumentRef>> {
  return approveOp(id, note);
}

export async function rejectAction(id: string, note: string): Promise<ActionResult<DocumentRef>> {
  return rejectOp(id, note);
}

export async function issueAction(id: string): Promise<ActionResult<IssueResult>> {
  return issueOp(id);
}

export async function duplicateAction(id: string): Promise<ActionResult<DocumentRef>> {
  return duplicateOp(id);
}

export async function convertAction(id: string): Promise<ActionResult<ConvertResult>> {
  return convertOp(id);
}
