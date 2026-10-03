import type { CurrencyCode } from "@/lib/finance/money";
import type { CustomerType } from "@/types/database";

export interface BuilderCustomer {
  id: string;
  name: string;
  niu: string | null;
  customer_type: CustomerType;
  payment_terms_days: number | null;
  default_currency: CurrencyCode;
  is_active: boolean;
}

export interface BuilderCatalogItem {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  /** Default selling price HT as plain decimal text. */
  unit_price: string;
  currency: CurrencyCode;
  tax_rate_id: string | null;
}

export interface BuilderDefaults {
  paymentTermsDays: number;
  validityDays: number;
  defaultTaxRateId: string | null;
  today: string;
}
