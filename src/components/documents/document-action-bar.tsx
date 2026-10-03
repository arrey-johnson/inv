"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Download, Eye, FileOutput, Loader2, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  approveAction,
  convertAction,
  deleteDraftAction,
  duplicateAction,
  issueAction,
  rejectAction,
  submitApprovalAction,
} from "@/app/(app)/sales/document-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/helpers";
import { DOCUMENT_ROUTES, DOCUMENT_TYPE_LABELS, type DocumentActions, type SalesDocumentType } from "@/lib/documents/status";
import { cn } from "@/lib/utils";

type Confirm = "issue" | "delete" | "convert" | "reject" | "approve" | null;

/**
 * Every workflow button for a document. Which buttons exist comes from `getDocumentActions` (server
 * computed); the server re-checks permission and state on every call, so hiding is only UX.
 */
export function DocumentActionBar({
  documentId,
  documentType,
  actions,
  ensureSaved,
  disabled = false,
  emphasizeIssue = false,
}: {
  documentId: string | null;
  documentType: SalesDocumentType;
  actions: DocumentActions;
  /** Editor hook: persists pending edits (or creates the draft) and returns the id, or null on failure. */
  ensureSaved?: () => Promise<string | null>;
  disabled?: boolean;
  /** Primary styling for Issue — used on the draft editor so the next step is obvious. */
  emphasizeIssue?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [note, setNote] = useState("");
  const [previewId, setPreviewId] = useState<{ id: string; nonce: number } | null>(null);
  const busy = pending || disabled;
  const label = DOCUMENT_TYPE_LABELS[documentType].toLowerCase();

  /** Save pending edits first (if this is the editor), then run the workflow step. */
  function run(task: (id: string) => Promise<void>) {
    startTransition(async () => {
      const id = ensureSaved ? await ensureSaved() : documentId;
      if (!id) return;
      await task(id);
    });
  }

  function report<T>(result: ActionResult<T>, onOk: (data: T) => void) {
    if (!result.ok) {
      toast.error(result.error, { description: result.details?.join("\n") });
      router.refresh();
      return;
    }
    onOk(result.data);
  }

  const preview = () =>
    run(async (id) => {
      setPreviewId({ id, nonce: Date.now() });
    });

  const submit = () =>
    run(async (id) =>
      report(await submitApprovalAction(id), () => {
        toast.success("Submitted for approval");
        router.refresh();
      }),
    );

  const approve = () => {
    setConfirm(null);
    run(async (id) =>
      report(await approveAction(id, note || undefined), () => {
        toast.success("Approved");
        setNote("");
        router.refresh();
      }),
    );
  };

  const reject = () => {
    const reason = note;
    setConfirm(null);
    run(async (id) =>
      report(await rejectAction(id, reason), () => {
        toast.success("Returned to the author");
        setNote("");
        router.refresh();
      }),
    );
  };

  const issue = () => {
    // Close the dialog first; keep the async work outside AlertDialogAction's default dismiss race.
    setConfirm(null);
    run(async (id) =>
      report(await issueAction(id), (data) => {
        toast.success(`Issued ${data.number ?? ""}`.trim(), {
          description: data.warnings.length ? data.warnings.join("\n") : undefined,
        });
        if (data.pdfError) toast.error("Issued, but the PDF could not be generated yet", { description: data.pdfError });
        router.replace(data.href);
        router.refresh();
      }),
    );
  };

  const remove = () => {
    setConfirm(null);
    if (!documentId) return;
    startTransition(async () => {
      report(await deleteDraftAction(documentId), () => {
        toast.success("Draft deleted");
        router.replace(DOCUMENT_ROUTES[documentType]);
        router.refresh();
      });
    });
  };

  const duplicate = () => {
    if (!documentId) return;
    startTransition(async () => {
      report(await duplicateAction(documentId), (data) => {
        toast.success("Draft copy created");
        router.push(data.href);
      });
    });
  };

  const convert = () => {
    setConfirm(null);
    if (!documentId) return;
    startTransition(async () => {
      report(await convertAction(documentId), (data) => {
        const invoice = data.invoice;
        toast.success(data.issued ? `Invoice ${invoice.number ?? ""} created` : "Invoice draft created", {
          description: data.draftReason ?? undefined,
        });
        router.push(invoice.href);
      });
    });
  };

  const pdfHref = documentId ? `/api/documents/${documentId}/pdf` : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.pdf && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={preview}>
            <Eye className="size-4" aria-hidden /> Preview PDF
          </Button>
        )}
        {actions.pdf && pdfHref && (
          <a href={`${pdfHref}?download=1`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Download className="size-4" aria-hidden /> Download
          </a>
        )}
        {actions.duplicate && documentId && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={duplicate}>
            <Copy className="size-4" aria-hidden /> Duplicate
          </Button>
        )}
        {actions.convert && (
          <Button type="button" size="sm" disabled={busy} onClick={() => setConfirm("convert")}>
            <FileOutput className="size-4" aria-hidden /> Convert to invoice
          </Button>
        )}
        {actions.submitForApproval && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={submit}>
            <Send className="size-4" aria-hidden /> Submit for approval
          </Button>
        )}
        {actions.reject && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("reject")}>
            <XCircle className="size-4" aria-hidden /> Reject
          </Button>
        )}
        {actions.approve && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("approve")}>
            <ShieldCheck className="size-4" aria-hidden /> Approve
          </Button>
        )}
        {actions.issue && (
          <Button type="button" size="sm" disabled={busy} onClick={() => setConfirm("issue")}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
            Issue {label}
          </Button>
        )}
        {actions.deleteDraft && documentId && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm("delete")}>
            <Trash2 className="size-4" aria-hidden /> Delete draft
          </Button>
        )}
      </div>
      {actions.issueBlockedReason && <p className="text-xs text-muted-foreground">{actions.issueBlockedReason}</p>}
      {emphasizeIssue && actions.issue && (
        <p className="text-xs text-muted-foreground">
          Drafts stay editable after you save. Issue only when the {label} is final — that assigns the official number.
        </p>
      )}

      <AlertDialog open={confirm === "issue"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue this {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              An official number is assigned, customer and company details are frozen on the PDF, and the stamped PDF is
              generated. You can still edit this document later — the same number is kept and the PDF is regenerated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                issue();
              }}
            >
              Issue {label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "delete"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>Drafts have no official number, so nothing is lost from your numbering.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "convert"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert this proforma to an invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              A new invoice is created from the proforma lines and issued with its own number when approval is not
              required. The proforma is marked as converted and keeps its number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={convert}>Convert</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={confirm === "approve" || confirm === "reject"} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "reject" ? "Reject document" : "Approve document"}</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={confirm === "reject" ? "Why is this rejected? (required)" : "Optional note"}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === "reject" ? (
              <Button type="button" size="sm" disabled={!note.trim()} onClick={reject}>
                Reject
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={approve}>
                Approve
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewId !== null} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent className="h-[90vh] w-[min(64rem,95vw)] max-w-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>PDF preview</DialogTitle>
          </DialogHeader>
          {previewId && (
            <iframe
              title="PDF preview"
              src={`/api/documents/${previewId.id}/pdf?v=${previewId.nonce}`}
              className="h-full w-full rounded-md border"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
