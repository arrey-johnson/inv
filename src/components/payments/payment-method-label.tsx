import { Banknote, CreditCard, Landmark, ScrollText, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import type { PaymentMethod } from "@/types/database";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  mtn_momo: "MTN MoMo",
  orange_money: "Orange Money",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

const ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  bank_transfer: Landmark,
  mtn_momo: Smartphone,
  orange_money: Smartphone,
  mobile_money: Smartphone,
  cheque: ScrollText,
  card: CreditCard,
  other: Wallet,
};

export function PaymentMethodLabel({ method }: { method: PaymentMethod }) {
  const Icon = ICONS[method];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {PAYMENT_METHOD_LABELS[method]}
    </span>
  );
}
