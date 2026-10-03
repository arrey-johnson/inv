import { buildDraftWrite } from "@/lib/documents/build";
import { issueDocument, type IssueDependencies, type IssueOutcome } from "@/lib/documents/issue-service";
import { ServiceError, calculateOrThrow, loadBundle, loadSettings, need, toServiceError, type Actor } from "@/lib/documents/service-support";
import { calculateCreditNoteCapacity } from "@/lib/finance/calculate-document";
import { formatMoney } from "@/lib/finance/format";
import { todayISO } from "@/lib/utils/date-math";
import type { DocumentBundle, Repository } from "@/lib/data/types";
import type { DocumentRow } from "@/types/database";
import {
  buildCreditContext,
  buildCreditNoteDocument,
  creditNoteInputSchema,
  type CreditContext,
} from "./build-credit-note";

const CREDITABLE_STATUSES = new Set(["issued", "sent", "partially_paid", "paid", "overdue"]);

/** Load an invoice and the credit notes already applied to it. */
export async function loadCreditContext(repo: Repository, invoiceId: string): Promise<CreditContext> {
  const invoice = await loadBundle(repo, invoiceId);
  const links = await repo.settlement.creditLinks({ invoiceId });
  const noteIds = [...new Set(links.map((l) => l.credit_note_id))];
  const notes: DocumentBundle[] = [];
  for (const id of noteIds) {
    const note = await repo.documents.get(id);
    if (note) notes.push(note);
  }
  return buildCreditContext(invoice, notes);
}

export interface CreditNoteOutcome {
  creditNote: DocumentRow;
  invoice: DocumentRow;
  issue: IssueOutcome;
}

/**
 * Credit an issued invoice. The invoice itself is never edited or deleted: a NEW credit note document is
 * created from its lines (HT and VAT reversed at the rates that were charged), issued with its own number,
 * linked to the invoice (`credit_for`) and applied to it, which lowers the balance. All in one operation:
 * if any step fails the draft is removed so nothing half-done is left behind.
 */
export async function createCreditNote(
  repo: Repository,
  actor: Actor,
  rawInput: unknown,
  deps: IssueDependencies,
  today: string = todayISO(),
): Promise<CreditNoteOutcome> {
  try {
    need(actor, "credit_notes.create");
    need(actor, "credit_notes.issue");
    const parsed = creditNoteInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid credit note.", "invalid");
    const input = parsed.data;

    const context = await loadCreditContext(repo, input.invoiceId);
    const invoice = context.invoice.document;
    if (invoice.document_type !== "invoice") throw new ServiceError("Only invoices can be credited.", "invalid");
    if (!CREDITABLE_STATUSES.has(invoice.status)) {
      throw new ServiceError(
        invoice.status === "draft"
          ? "A draft invoice is edited or deleted, not credited."
          : invoice.status === "void"
            ? "This invoice is cancelled, so there is nothing to credit."
            : invoice.status === "credited"
              ? "This invoice has already been credited in full."
              : `A ${invoice.status} invoice cannot be credited.`,
        "conflict",
      );
    }

    const [settings, taxRates] = await Promise.all([loadSettings(repo), repo.taxes.listRates()]);
    const resolved = buildCreditNoteDocument(context, input, { today, taxRates, vatEnabled: settings.vat_registered });
    const calc = calculateOrThrow(resolved);

    const capacity = calculateCreditNoteCapacity({
      currency: invoice.currency,
      invoiceTotalTTC: invoice.total_ttc,
      alreadyCredited: context.creditedTTC,
      creditNoteTotalTTC: calc.totalTTC,
    });
    if (!capacity.isValid) {
      throw new ServiceError(
        `The credit note (${formatMoney(calc.totalTTC, invoice.currency)}) is more than what can still be credited on ${invoice.number} ` +
          `(${formatMoney(capacity.creditableRemaining, invoice.currency)}).`,
        "invalid",
      );
    }
    if (calc.totalTTC <= 0) throw new ServiceError("The credit note total must be greater than zero.", "invalid");

    const draft = await repo.documents.insertDraft(buildDraftWrite(resolved, calc));
    let issue: IssueOutcome;
    try {
      issue = await issueDocument(repo, actor, draft.id, deps);
    } catch (cause) {
      await repo.documents.deleteDraft(draft.id).catch(() => undefined);
      throw cause;
    }

    const note = issue.document;
    let updatedInvoice: DocumentRow;
    try {
      await repo.documents.link(note.id, invoice.id, "credit_for");
      updatedInvoice = await repo.settlement.applyCreditNote({
        creditNoteId: note.id,
        invoiceId: invoice.id,
        amount: note.total_ttc,
      });
    } catch (cause) {
      // Issued but could not be applied: cancel it (number kept, reason recorded) rather than leave it dangling.
      await repo.documents.voidDocument(note.id, "Could not be applied to the invoice (automatic cancellation).").catch(() => undefined);
      throw cause;
    }

    await repo.writeAudit({
      action: "credit_note.create",
      entityType: "document",
      entityId: note.id,
      metadata: {
        number: note.number,
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        mode: input.mode,
        reason: input.reason,
        total_ttc: note.total_ttc,
      },
    });
    await repo.writeAudit({
      action: "credit_note.apply",
      entityType: "document",
      entityId: invoice.id,
      metadata: {
        credit_note_id: note.id,
        credit_note_number: note.number,
        amount: note.total_ttc,
        balance_due: updatedInvoice.balance_due,
        status: updatedInvoice.status,
        reason: input.reason,
        summary: `Credit note ${note.number} of ${formatMoney(note.total_ttc, invoice.currency)}`,
      },
    });

    return { creditNote: note, invoice: updatedInvoice, issue };
  } catch (cause) {
    throw toServiceError(cause);
  }
}
