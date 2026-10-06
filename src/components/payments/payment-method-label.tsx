import { Banknote, CreditCard, Landmark, ScrollText, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments/payment-method-labels";
import type { PaymentMethod } from "@/types/database";

export { PAYMENT_METHOD_LABELS };

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
