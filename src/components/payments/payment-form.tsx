"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { recordPaymentAction } from "@/app/(app)/sales/finance-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/finance/format";
import { D, sumDecimals, type CurrencyCode } from "@/lib/finance/money";
import { allocateOldestFirst } from "@/lib/payments/settlement";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/database";
import { PAYMENT_METHOD_LABELS } from "./payment-method-label";

export interface OpenInvoiceView {
  id: string;
  number: string;
  type: string;
  dueDate: string | null;
  currency: CurrencyCode;
  balanceDue: number;
  total: number;
  overdue: boolean;
}

const METHODS = PAYMENT_METHODS.filter((m) => m !== "mobile_money") as PaymentMethod[];

/**
 * Record a payment. The browser helps (oldest-first suggestion, running totals) but never decides:
 * the server validates the allocations again and recomputes every balance and status.
 */
export function PaymentForm({
  customerId,
  customerName,
  invoices,
  today,
  canAdjust,
  preselectInvoiceId,
}: {
  customerId: string;
  customerName: string;
  invoices: OpenInvoiceView[];
  today: string;
  canAdjust: boolean;
  preselectInvoiceId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const currencies = [...new Set(invoices.map((i) => i.currency))];
  const [currency, setCurrency] = useState<CurrencyCode>(
    invoices.find((i) => i.id === preselectInvoiceId)?.currency ?? currencies[0] ?? "XAF",
  );
  const visible = useMemo(() => invoices.filter((i) => i.currency === currency), [invoices, currency]);

  const initial = visible.find((i) => i.id === preselectInvoiceId);
  const [amount, setAmount] = useState(initial ? String(initial.balanceDue) : "");
  const [allocations, setAllocations] = useState<Record<string, string>>(initial ? { [initial.id]: String(initial.balanceDue) } : {});
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [adjustment, setAdjustment] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  const parsedAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const allocated = sumDecimals(Object.values(allocations).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))).toNumber();
  const unapplied = amountValid ? new D(parsedAmount).minus(allocated).toNumber() : 0;

  function suggest(nextAmount: string) {
    setAmount(nextAmount);
    const n = Number(nextAmount.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setAllocations({});
      return;
    }
    const { allocations: auto } = allocateOldestFirst(
      n,
      visible.map((v) => ({ id: v.id, balance_due: v.balanceDue, due_date: v.dueDate, currency: v.currency })),
      currency,
    );
    setAllocations(Object.fromEntries(auto.map((a) => [a.documentId, String(a.amount)])));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    form.set("customerId", customerId);
    form.set("currency", currency);
    form.set("method", method);
    form.set("amount", String(parsedAmount));
    form.set(
      "allocations",
      JSON.stringify(
        Object.entries(allocations)
          .filter(([, v]) => Number(v) > 0)
          .map(([documentId, v]) => ({ documentId, amount: Number(v) })),
      ),
    );
    if (adjustment) form.set("isAdjustment", "true");
    startTransition(async () => {
      const result = await recordPaymentAction(form);
      if (!result.ok) {
        setError({ message: result.error, details: result.details ?? [] });
        return;
      }
      const left = result.data.documents.map((d) => `${d.number ?? "invoice"}: balance ${d.balanceDue}`).join(" | ");
      toast.success("Payment recorded", { description: left });
      router.push(result.data.href);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">{error.message}</p>
            {error.details.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {error.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Customer</Label>
          <p className="flex h-8 items-center text-sm font-medium">{customerName}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-date">Payment date</Label>
          <Input id="p-date" name="paymentDate" type="date" defaultValue={today} max={today} required />
        </div>
        {currencies.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="p-cur">Currency</Label>
            <NativeSelect
              id="p-cur"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value as CurrencyCode);
                setAmount("");
                setAllocations({});
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <p className="flex h-8 items-center text-sm font-medium">{currency}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="p-amount">Amount received</Label>
          <Input
            id="p-amount"
            inputMode="decimal"
            className="text-right tabular-nums"
            value={amount}
            onChange={(e) => suggest(e.target.value)}
            placeholder="0"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-method">Method</Label>
          <NativeSelect id="p-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-ref">Reference (transfer no., cheque no., MoMo ID...)</Label>
          <Input id="p-ref" name="reference" maxLength={120} />
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Apply to invoices</h3>
          <p className="text-xs text-muted-foreground">Typing the amount suggests oldest-due-first. You can change the split.</p>
        </div>
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">This customer has no open invoice in {currency}.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Total TTC</th>
                  <th className="px-3 py-2 text-right">Balance due</th>
                  <th className="px-3 py-2 text-right">Apply</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((inv) => {
                  const value = allocations[inv.id] ?? "";
                  const over = Number(value) > inv.balanceDue;
                  return (
                    <tr key={inv.id} className="border-t">
                      <td className="px-3 py-2 font-medium">
                        {inv.number}
                        {inv.type === "advance" && <span className="ml-1 text-xs text-muted-foreground">(advance)</span>}
                      </td>
                      <td className={`px-3 py-2 ${inv.overdue ? "text-danger" : ""}`}>{inv.dueDate ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(inv.total, inv.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(inv.balanceDue, inv.currency)}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          aria-label={`Amount applied to ${inv.number}`}
                          inputMode="decimal"
                          className="ml-auto h-8 w-36 text-right tabular-nums"
                          aria-invalid={over}
                          value={value}
                          onChange={(e) => setAllocations((a) => ({ ...a, [inv.id]: e.target.value }))}
                        />
                        {over && <p className="text-xs text-destructive">More than the balance due</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={`text-sm ${amountValid && unapplied !== 0 ? "text-destructive" : "text-muted-foreground"}`}>
          Applied {formatMoney(allocated, currency)}
          {amountValid ? ` of ${formatMoney(parsedAmount, currency)}` : ""}
          {amountValid && unapplied > 0 ? ` - ${formatMoney(unapplied, currency)} not applied (every franc must be applied to an invoice)` : ""}
          {amountValid && unapplied < 0 ? ` - ${formatMoney(-unapplied, currency)} more than the payment` : ""}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-notes">Notes</Label>
          <Textarea id="p-notes" name="notes" rows={3} maxLength={1000} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-proof">Proof of payment (PDF, PNG, JPG, WEBP - max 5 MB)</Label>
          <Input id="p-proof" name="proof" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" />
        </div>
      </div>

      {canAdjust && (
        <fieldset className="space-y-2 rounded-md border border-warning/40 p-3">
          <legend className="px-1 text-sm font-medium">Administrator adjustment</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={adjustment}
              onChange={(e) => setAdjustment(e.target.checked)}
            />
            <span>
              This is a settlement outside the system (not a cash receipt). It marks the invoice as settled, is flagged &quot;Adjustment&quot; and is written to the
              audit trail with your reason.
            </span>
          </label>
          {adjustment && <Textarea name="adjustmentReason" rows={2} placeholder="Reason (required, at least 10 characters)" />}
        </fieldset>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !amountValid || unapplied !== 0}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Record payment
        </Button>
      </div>
    </form>
  );
}
