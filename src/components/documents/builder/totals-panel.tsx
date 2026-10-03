import { formatMoney, formatPercent } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export interface TotalsView {
  subtotal: number;
  lineDiscountTotal: number;
  globalDiscountAmount: number;
  netHT: number;
  taxBreakdown: ReadonlyArray<{ rate: number; taxAmount: number }>;
  taxTotal: number;
  totalTTC: number;
  /** Optional withholding (retenue a la source): affects the cash payable, never the commercial TTC. */
  withholdings?: ReadonlyArray<{ code: string; rate: number; amount: number }>;
  withholdingTotal?: number;
  netPayable?: number;
}

/** Shared by the live editor preview and the read-only document view. */
export function TotalsPanel({ totals, currency, vatEnabled = true }: { totals: TotalsView | null; currency: CurrencyCode; vatEnabled?: boolean }) {
  const money = (value: number | undefined) => formatMoney(value ?? 0, currency);
  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: "Subtotal", value: money(totals?.subtotal) },
  ];
  if (totals && totals.lineDiscountTotal > 0) rows.push({ label: "Line discounts", value: `- ${money(totals.lineDiscountTotal)}`, muted: true });
  if (totals && totals.globalDiscountAmount > 0) rows.push({ label: "Global discount", value: `- ${money(totals.globalDiscountAmount)}`, muted: true });
  rows.push({ label: "Total HT", value: money(totals?.netHT) });
  if (vatEnabled) {
    const breakdown = totals?.taxBreakdown.filter((t) => t.rate > 0) ?? [];
    if (breakdown.length === 0) rows.push({ label: "VAT", value: money(totals?.taxTotal) });
    for (const entry of breakdown) rows.push({ label: `VAT ${formatPercent(entry.rate)}`, value: money(entry.taxAmount) });
  }

  return (
    <dl className="w-full space-y-1.5 text-sm sm:max-w-sm">
      {rows.map((row) => (
        <div key={row.label} className={cn("flex justify-between gap-6", row.muted && "text-muted-foreground")}>
          <dt>{row.label}</dt>
          <dd className="tabular-nums">{row.value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-6 border-t pt-2 text-base font-semibold">
        <dt>Total TTC</dt>
        <dd className="tabular-nums" data-testid="total-ttc">
          {money(totals?.totalTTC)}
        </dd>
      </div>
      {totals && totals.withholdings && totals.withholdings.length > 0 && (
        <>
          {totals.withholdings.map((w) => (
            <div key={w.code} className="flex justify-between gap-6 text-muted-foreground">
              <dt>Less withholding {w.code} ({formatPercent(w.rate)})</dt>
              <dd className="tabular-nums">- {money(w.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 border-t pt-2 text-base font-semibold text-primary">
            <dt>Net payable</dt>
            <dd className="tabular-nums" data-testid="net-payable">
              {money(totals.netPayable)}
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}
