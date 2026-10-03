import { Badge } from "@/components/ui/badge";
import type { CustomerType } from "@/types/database";

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "Individual",
  company: "Company",
  government: "Government",
  ngo: "NGO",
};

export function CustomerTypeBadge({ type }: { type: CustomerType }) {
  return <Badge variant="secondary">{CUSTOMER_TYPE_LABELS[type]}</Badge>;
}
