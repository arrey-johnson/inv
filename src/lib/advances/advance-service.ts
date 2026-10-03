import { z } from "zod";
import { ServiceError, loadBundle, need, toServiceError, type Actor } from "@/lib/documents/service-support";
import { D, roundMoney, sumDecimals, toDecimal, type CurrencyCode, type DecimalInput } from "@/lib/finance/money";
import { formatMoney } from "@/lib/finance/format";
import type { Repository } from "@/lib/data/types";
import type { AdvanceLink, DocumentRow } from "@/types/database";

/**
 * Advance (deposit) invoices and their deduction from the final invoice.
 *
 * VAT is declared when the advance is invoiced, so it must NOT be charged a second time when the final
 * invoice is issued. The final invoice always shows its full total; each deduction records how much of
 * the advance was HT and how much was VAT (proportional to the advance), and the VAT summary subtracts
 * the VAT of applied advances from the final invoice's VAT.
 */

/** Split a TTC amount of an advance into HT and VAT, proportionally to the advance. */
export function splitAdvanceAmount(input: {
  currency: CurrencyCode;
  advanceTotalTTC: DecimalInput;
  advanceTaxTotal: DecimalInput;
  /** Amount (TTC) being deducted now. */
  amount: DecimalInput;
  /** Amounts already deducted from this advance, with the VAT they carried. */
  previous: ReadonlyArray<{ amount: DecimalInput; vatAmount: DecimalInput }>;
}): { htAmount: number; vatAmount: number } {
  const total = roundMoney(input.advanceTotalTTC, input.currency);
  const amount = roundMoney(input.amount, input.currency);
  const taxTotal = roundMoney(input.advanceTaxTotal, input.currency);
  const usedAmount = sumDecimals(input.previous.map((p) => p.amount));
  const usedVat = sumDecimals(input.previous.map((p) => p.vatAmount));

  let vat: InstanceType<typeof D>;
  if (total.isZero()) vat = new D(0);
  else if (usedAmount.plus(amount).greaterThanOrEqualTo(total)) {
    // Last deduction takes whatever VAT is left, so the parts always add up to the advance exactly.
    vat = taxTotal.minus(usedVat);
  } else {
    vat = roundMoney(amount.times(taxTotal).dividedBy(total), input.currency);
  }
  if (vat.isNegative()) vat = new D(0);
  if (vat.greaterThan(amount)) vat = amount;
  return { htAmount: amount.minus(vat).toNumber(), vatAmount: vat.toNumber() };
}

/** What is left of an advance to deduct. */
export function advanceRemaining(advance: Pick<DocumentRow, "total_ttc" | "currency">, links: ReadonlyArray<Pick<AdvanceLink, "amount">>): number {
  const left = roundMoney(advance.total_ttc, advance.currency).minus(sumDecimals(links.map((l) => l.amount)));
  return left.greaterThan(0) ? left.toNumber() : 0;
}

export const applyAdvanceSchema = z.object({
  advanceId: z.string().uuid("Choose an advance."),
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive("Enter an amount greater than zero.").optional().nullable(),
});

export interface ApplyAdvanceResult {
  invoice: DocumentRow;
  applied: number;
  htAmount: number;
  vatAmount: number;
}

export async function applyAdvanceToInvoice(repo: Repository, actor: Actor, rawInput: unknown): Promise<ApplyAdvanceResult> {
  try {
    need(actor, "advances.apply");
    const parsed = applyAdvanceSchema.safeParse(rawInput);
    if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid advance.", "invalid");
    const { advanceId, invoiceId } = parsed.data;

    const [advanceBundle, invoiceBundle] = await Promise.all([loadBundle(repo, advanceId), loadBundle(repo, invoiceId)]);
    const advance = advanceBundle.document;
    const invoice = invoiceBundle.document;
    if (advance.document_type !== "advance") throw new ServiceError("That document is not an advance invoice.", "invalid");
    if (invoice.document_type !== "invoice") throw new ServiceError("Advances are deducted from final invoices.", "invalid");
    if (advance.status !== "paid") {
      throw new ServiceError(
        `Advance ${advance.number ?? ""} has not been paid in full yet. Record its payment before deducting it.`,
        "conflict",
      );
    }
    if (!["issued", "sent", "partially_paid", "overdue"].includes(invoice.status)) {
      throw new ServiceError("Advances can only be deducted from an invoice that still has a balance to pay.", "conflict");
    }
    if (advance.customer_id !== invoice.customer_id) {
      throw new ServiceError("The advance belongs to a different customer.", "invalid");
    }
    if (advance.currency !== invoice.currency) {
      throw new ServiceError(`The advance is in ${advance.currency} and the invoice in ${invoice.currency}.`, "invalid");
    }

    const links = await repo.settlement.advanceLinks({ advanceId });
    const remaining = advanceRemaining(advance, links);
    if (remaining <= 0) throw new ServiceError(`Advance ${advance.number ?? ""} has already been fully deducted.`, "conflict");

    const money = (v: number) => formatMoney(v, invoice.currency);
    const requested = parsed.data.amount ?? Math.min(remaining, invoice.balance_due);
    const amount = roundMoney(requested, invoice.currency).toNumber();
    if (amount > remaining) {
      throw new ServiceError(`Only ${money(remaining)} remains on advance ${advance.number ?? ""}.`, "invalid");
    }
    if (amount > invoice.balance_due) {
      throw new ServiceError(
        `The amount (${money(amount)}) is more than the balance due on ${invoice.number ?? "the invoice"} (${money(invoice.balance_due)}).`,
        "invalid",
      );
    }
    if (amount <= 0) throw new ServiceError("There is nothing to deduct.", "invalid");

    const split = splitAdvanceAmount({
      currency: invoice.currency,
      advanceTotalTTC: advance.total_ttc,
      advanceTaxTotal: advance.tax_total,
      amount,
      previous: links.map((l) => ({ amount: l.amount, vatAmount: l.vat_amount })),
    });
    const updated = await repo.settlement.applyAdvance({
      advanceId,
      invoiceId,
      amount,
      htAmount: split.htAmount,
      vatAmount: split.vatAmount,
    });
    const existingLinks = await repo.documents.linksFor(invoiceId);
    if (!existingLinks.some((l) => l.link_type === "advance_for" && l.source_document_id === advanceId)) {
      await repo.documents.link(advanceId, invoiceId, "advance_for");
    }

    const summary = `Advance ${advance.number} of ${money(amount)} deducted (VAT ${money(split.vatAmount)} already declared on the advance)`;
    await repo.writeAudit({
      action: "advance.apply",
      entityType: "document",
      entityId: invoiceId,
      metadata: {
        advance_id: advanceId,
        advance_number: advance.number,
        amount,
        ht_amount: split.htAmount,
        vat_amount: split.vatAmount,
        balance_due: updated.balance_due,
        status: updated.status,
        summary,
      },
    });
    await repo.writeAudit({
      action: "advance.apply",
      entityType: "document",
      entityId: advanceId,
      metadata: { invoice_id: invoiceId, invoice_number: invoice.number, amount, summary },
    });
    return { invoice: updated, applied: amount, htAmount: split.htAmount, vatAmount: split.vatAmount };
  } catch (cause) {
    throw toServiceError(cause);
  }
}

/**
 * Advances of a customer that can still be deducted (paid, not fully used), oldest first.
 */
export async function listAvailableAdvances(
  repo: Repository,
  customerId: string,
  currency?: CurrencyCode,
): Promise<Array<{ advance: DocumentRow; remaining: number }>> {
  const advances = await repo.documents.listAll({ type: "advance", statuses: ["paid"], customerId, today: "9999-12-31" });
  const out: Array<{ advance: DocumentRow; remaining: number }> = [];
  for (const advance of [...advances].reverse()) {
    if (currency && advance.currency !== currency) continue;
    const remaining = advanceRemaining(advance, await repo.settlement.advanceLinks({ advanceId: advance.id }));
    if (remaining > 0) out.push({ advance, remaining });
  }
  return out;
}

/** Deduct available advances (oldest first) up to the balance of a freshly issued invoice. */
export async function applyAdvancesAtIssue(
  repo: Repository,
  actor: Actor,
  invoiceId: string,
  advanceIds: string[],
): Promise<{ applied: number; notes: string[] }> {
  let applied = 0;
  const notes: string[] = [];
  for (const advanceId of advanceIds) {
    try {
      const result = await applyAdvanceToInvoice(repo, actor, { advanceId, invoiceId });
      applied = toDecimal(applied).plus(result.applied).toNumber();
    } catch (cause) {
      const error = toServiceError(cause);
      notes.push(error.message);
    }
  }
  return { applied, notes };
}
