import { formatPercent } from "@/lib/finance/format";
import type { TaxRate } from "@/types/database";

/** Active tax rates as select options ("VAT 19.25% (19.25%)"). */
export function taxRateOptions(rates: ReadonlyArray<TaxRate>): { value: string; label: string }[] {
  return rates.filter((r) => r.is_active).map((r) => ({ value: r.id, label: `${r.name} (${formatPercent(r.rate)})` }));
}
