import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/types/database";

/** Semantic status colours (not brand colours): neutral -> info -> success / warning / danger. */
const STATUS_STYLES: Record<DocumentStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  issued: { label: "Issued", className: "bg-info-soft text-info" },
  sent: { label: "Sent", className: "bg-info-soft text-info" },
  accepted: { label: "Accepted", className: "bg-success-soft text-success" },
  rejected: { label: "Rejected", className: "bg-danger-soft text-danger" },
  expired: { label: "Expired", className: "bg-warning-soft text-warning" },
  converted: { label: "Converted", className: "bg-secondary text-secondary-foreground" },
  partially_paid: { label: "Partially paid", className: "bg-warning-soft text-warning" },
  paid: { label: "Paid", className: "bg-success-soft text-success" },
  overdue: { label: "Overdue", className: "bg-danger-soft text-danger" },
  credited: { label: "Credited", className: "bg-secondary text-secondary-foreground" },
  // "Void" is the stored status; users see "Cancelled" (the number is kept and the PDF says CANCELLED).
  void: { label: "Cancelled", className: "bg-muted text-muted-foreground line-through" },
};

export function documentStatusLabel(status: DocumentStatus): string {
  return STATUS_STYLES[status].label;
}

export function DocumentStatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", style.className, className)}>
      {style.label}
    </Badge>
  );
}
