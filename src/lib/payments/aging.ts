import { daysBetweenISO } from "@/lib/utils/date-math";

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Not yet due",
  d1_30: "1-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d90_plus: "90+ days",
};

/** Whole days an invoice is past due (0 when not due yet or without a due date). */
export function daysOverdue(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  return Math.max(0, daysBetweenISO(dueDate, today));
}

/** Aging bucket from the number of days past the DUE date (the day after the due date is day 1). */
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const days = daysOverdue(dueDate, today);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/** Business rule: OVERDUE means past the due date with a balance still owed. */
export function isOverdue(
  doc: { due_date: string | null; balance_due: number; status: string },
  today: string,
): boolean {
  if (doc.status === "paid" || doc.status === "void" || doc.status === "credited" || doc.status === "draft") return false;
  return doc.due_date !== null && doc.due_date < today && doc.balance_due > 0;
}
