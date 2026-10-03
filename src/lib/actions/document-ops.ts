import "server-only";
import { z } from "zod";
import { approveDocument, rejectDocument, submitForApproval } from "@/lib/documents/approval-service";
import { deleteDraft, duplicateDocument, saveDocument } from "@/lib/documents/draft-service";
import { convertProformaToInvoice, issueDocument, type IssueOutcome } from "@/lib/documents/issue-service";
import { documentInputSchema } from "@/lib/documents/schema";
import { DOCUMENT_ROUTES, isSalesDocumentType } from "@/lib/documents/status";
import { renderRepositoryDocumentPdf } from "@/lib/pdf/render-document";
import { authorize, failure, invalidInput, isFailure, revalidateSales, succeed, type ActionResult } from "./helpers";

/**
 * The document operations behind BOTH the server actions (UI) and the route handlers (API).
 * Each one: session -> input validation -> domain service (which re-checks permissions and state).
 */

const idSchema = z.string().uuid("Invalid document id");

const deps = { renderPdf: renderRepositoryDocumentPdf };

export interface DocumentRef {
  id: string;
  number: string | null;
  status: string;
  type: string;
  /** App path of the document page. */
  href: string;
  /** Set when an issued document was amended but PDF regeneration failed. */
  pdfError?: string | null;
}

function ref(
  doc: { id: string; number: string | null; status: string; document_type: string },
  extra?: { pdfError?: string | null },
): DocumentRef {
  const base = isSalesDocumentType(doc.document_type as "invoice") ? DOCUMENT_ROUTES[doc.document_type as "invoice" | "proforma"] : "/sales";
  return {
    id: doc.id,
    number: doc.number,
    status: doc.status,
    type: doc.document_type,
    href: `${base}/${doc.id}`,
    pdfError: extra?.pdfError ?? null,
  };
}

export interface IssueResult extends DocumentRef {
  warnings: string[];
  pdfError: string | null;
  pdfSha256: string | null;
}

function issueResult(outcome: IssueOutcome): IssueResult {
  return {
    ...ref(outcome.document),
    warnings: outcome.warnings.map((w) => w.message),
    pdfError: outcome.pdfError,
    pdfSha256: outcome.pdfSha256,
  };
}

export async function saveDraftOp(input: unknown, id?: string | null): Promise<ActionResult<DocumentRef>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (id && !idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  const parsed = documentInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const saved = await saveDocument(auth.repo, { role: auth.ctx.role }, parsed.data, id ?? undefined, deps);
    revalidateSales();
    return succeed(ref(saved.document, { pdfError: saved.pdfError }));
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDraftOp(id: string): Promise<ActionResult> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    await deleteDraft(auth.repo, { role: auth.ctx.role }, id);
    revalidateSales();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

export async function submitApprovalOp(id: string): Promise<ActionResult<DocumentRef>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const doc = await submitForApproval(auth.repo, { role: auth.ctx.role }, id);
    revalidateSales();
    return succeed(ref(doc));
  } catch (error) {
    return failure(error);
  }
}

export async function approveOp(id: string, note?: string | null): Promise<ActionResult<DocumentRef>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const doc = await approveDocument(auth.repo, { role: auth.ctx.role }, id, note ?? null);
    revalidateSales();
    return succeed(ref(doc));
  } catch (error) {
    return failure(error);
  }
}

export async function rejectOp(id: string, note: string): Promise<ActionResult<DocumentRef>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const doc = await rejectDocument(auth.repo, { role: auth.ctx.role }, id, note);
    revalidateSales();
    return succeed(ref(doc));
  } catch (error) {
    return failure(error);
  }
}

export async function issueOp(id: string): Promise<ActionResult<IssueResult>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const outcome = await issueDocument(auth.repo, { role: auth.ctx.role }, id, deps);
    revalidateSales();
    return succeed(issueResult(outcome));
  } catch (error) {
    return failure(error);
  }
}

export async function duplicateOp(id: string): Promise<ActionResult<DocumentRef>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const draft = await duplicateDocument(auth.repo, { role: auth.ctx.role }, id);
    revalidateSales();
    return succeed(ref(draft));
  } catch (error) {
    return failure(error);
  }
}

export interface ConvertResult {
  invoice: IssueResult | DocumentRef;
  issued: boolean;
  draftReason: string | null;
}

export async function convertOp(id: string): Promise<ActionResult<ConvertResult>> {
  const auth = await authorize();
  if (isFailure(auth)) return auth;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid document id" };
  try {
    const outcome = await convertProformaToInvoice(auth.repo, { role: auth.ctx.role }, id, deps);
    revalidateSales();
    return succeed({
      invoice: outcome.issue ? issueResult(outcome.issue) : ref(outcome.invoice),
      issued: outcome.issue !== null,
      draftReason: outcome.draftReason,
    });
  } catch (error) {
    return failure(error);
  }
}
