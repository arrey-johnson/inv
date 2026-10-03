"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCreditNoteAction } from "@/app/(app)/sales/finance-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";

type Mode = "full" | "lines" | "amount";

export interface CreditLineView {
  itemId: string;
  description: string;
  quantity: number;
  credited: number;
  remaining: number;
  unitPrice: number;
  taxRate: number;
}

/**
 * Credit an issued invoice: all of it, chosen quantities per line, or an amount. The invoice itself is
 * never changed - a separate credit note with its own number is created and linked to it.
 */
export function CreditNoteForm({
  invoiceId,
  invoiceNumber,
  currency,
  totalTtc,
  creditedTtc,
  remainingTtc,
  lines,
  taxRates,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currency: CurrencyCode;
  totalTtc: number;
  creditedTtc: number;
  remainingTtc: number;
  lines: CreditLineView[];
  taxRates: Array<{ id: string; name: string; rate: number }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(creditedTtc > 0 ? "lines" : "full");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [amountHt, setAmountHt] = useState("");
  const [taxRateId, setTaxRateId] = useState(taxRates[0]?.id ?? "");
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const money = (n: number) => formatMoney(n, currency);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload =
      mode === "full"
        ? { invoiceId, mode, reason }
        : mode === "lines"
          ? {
              invoiceId,
              mode,
              reason,
              lines: Object.entries(qty)
                .filter(([, v]) => Number(v) > 0)
                .map(([sourceItemId, v]) => ({ sourceItemId, quantity: Number(v) })),
            }
          : { invoiceId, mode, reason, amountHt: Number(amountHt), taxRateId: taxRateId || null };
    startTransition(async () => {
      const result = await createCreditNoteAction(payload);
      if (!result.ok) {
        setError({ message: result.error, details: result.details ?? [] });
        return;
      }
      toast.success(`Credit note ${result.data.number ?? ""} issued`, {
        description: result.data.pdfError ? `PDF could not be stored: ${result.data.pdfError}` : undefined,
      });
      router.push(result.data.href);
      router.refresh();
    });
  }

  const modes: Array<{ id: Mode; title: string; hint: string; disabled?: boolean }> = [
    { id: "full", title: "Full credit", hint: "Cancels everything still creditable on the invoice.", disabled: creditedTtc > 0 },
    { id: "lines", title: "By line", hint: "Credit some quantities of some lines (returns, partial delivery)." },
    { id: "amount", title: "By amount", hint: "A commercial gesture: an amount excluding VAT, at one VAT rate." },
  ];

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Invoice total TTC</p>
          <p className="font-semibold tabular-nums">{money(totalTtc)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Already credited</p>
          <p className="font-semibold tabular-nums">{money(creditedTtc)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Still creditable</p>
          <p className="font-semibold tabular-nums">{money(remainingTtc)}</p>
        </div>
      </div>

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

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">How much to credit on {invoiceNumber}</legend>
        {modes.map((m) => (
          <label
            key={m.id}
            className={`cursor-pointer rounded-lg border p-3 text-sm ${mode === m.id ? "border-primary bg-primary/5" : ""} ${m.disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="mode"
              className="mr-2 accent-primary"
              checked={mode === m.id}
              disabled={m.disabled}
              onChange={() => setMode(m.id)}
            />
            <strong>{m.title}</strong>
            <span className="mt-1 block text-xs text-muted-foreground">{m.hint}</span>
          </label>
        ))}
      </fieldset>

      {mode === "lines" && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Credited</th>
                <th className="px-3 py-2 text-right">Left</th>
                <th className="px-3 py-2 text-right">Credit quantity</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.itemId} className="border-t">
                  <td className="px-3 py-2">
                    {line.description}
                    <span className="block text-xs text-muted-foreground">
                      {money(line.unitPrice)} HT each{line.taxRate > 0 ? `, VAT ${line.taxRate}%` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.credited}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.remaining}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      aria-label={`Quantity to credit for ${line.description}`}
                      inputMode="decimal"
                      className="ml-auto h-8 w-28 text-right tabular-nums"
                      disabled={line.remaining <= 0}
                      value={qty[line.itemId] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [line.itemId]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "amount" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cn-amount">Amount excluding VAT ({currency})</Label>
            <Input id="cn-amount" inputMode="decimal" className="text-right tabular-nums" value={amountHt} onChange={(e) => setAmountHt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cn-tax">VAT rate</Label>
            <NativeSelect id="cn-tax" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)}>
              {taxRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.rate}%)
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="cn-reason">Reason (printed on the credit note)</Label>
        <Textarea id="cn-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Services not delivered / pricing error / customer cancelled" />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || reason.trim().length < 5}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Issue credit note
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        HT and VAT are reversed at the rates charged on the invoice. The credit note gets its own number and lowers the balance due; the invoice is not edited
        or deleted.
      </p>
    </form>
  );
}
