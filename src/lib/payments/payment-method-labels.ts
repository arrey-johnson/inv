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
