import { D, roundMoney, type CurrencyCode } from "@/lib/finance/money";

export interface DueNowSplit {
  percent: number;
  dueNow: number;
  dueLater: number;
  laterPercent: number;
}

/**
 * Split net payable into "due now" / "due later" from a schedule percent.
 * Returns null when unset, or when the schedule is 100% (nothing deferred).
 */
export function splitDueNow(
  netPayable: number,
  percent: number | null | undefined,
  currency: CurrencyCode,
): DueNowSplit | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  if (percent <= 0 || percent >= 100) return null;
  const dueNow = roundMoney(new D(netPayable).times(percent).div(100), currency).toNumber();
  const dueLater = roundMoney(new D(netPayable).minus(dueNow), currency).toNumber();
  return {
    percent,
    dueNow,
    dueLater,
    laterPercent: roundMoney(new D(100).minus(percent), currency).toNumber(),
  };
}
