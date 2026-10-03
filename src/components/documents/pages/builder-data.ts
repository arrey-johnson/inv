import type { Repository } from "@/lib/data/types";
import type { BuilderTaxRate, BuilderWithholdingType } from "@/lib/documents/builder-model";
import { todayISO } from "@/lib/utils/date-math";
import type { OrganizationSettings } from "@/types/database";
import type { BuilderCatalogItem, BuilderCustomer, BuilderDefaults } from "../builder/types";

export interface BuilderData {
  customers: BuilderCustomer[];
  catalog: BuilderCatalogItem[];
  taxRates: BuilderTaxRate[];
  withholdingTypes: BuilderWithholdingType[];
  settings: OrganizationSettings;
  vatEnabled: boolean;
  defaults: BuilderDefaults;
}

/** Everything the editor needs, shaped as plain serializable props. */
export async function loadBuilderData(repo: Repository): Promise<BuilderData | null> {
  const [customers, items, rates, withholdings, settings] = await Promise.all([
    repo.customers.listActive(1000),
    repo.items.listActive(1000),
    repo.taxes.listRates(),
    repo.taxes.listWithholdings(),
    repo.organization.getSettings(),
  ]);
  if (!settings) return null;

  const vatEnabled = settings.vat_registered;
  const defaultRate =
    rates.find((r) => r.id === settings.default_tax_rate_id && r.is_active) ?? rates.find((r) => r.is_default && r.is_active) ?? null;

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      niu: c.niu,
      customer_type: c.customer_type,
      payment_terms_days: c.payment_terms_days,
      default_currency: c.default_currency,
      is_active: c.is_active,
    })),
    catalog: items.map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      description: i.description,
      unit: i.unit,
      unit_price: String(i.unit_price),
      currency: i.currency,
      tax_rate_id: i.tax_rate_id,
    })),
    taxRates: rates.map((r) => ({ id: r.id, name: r.name, rate: r.rate, category: r.category, is_active: r.is_active })),
    withholdingTypes: withholdings
      .filter((w) => w.is_active)
      .map((w) => ({ id: w.id, code: w.code, name: w.name, rate: w.rate, base: w.base, is_active: true })),
    settings,
    vatEnabled,
    defaults: {
      paymentTermsDays: settings.default_payment_terms_days,
      validityDays: settings.proforma_validity_days,
      defaultTaxRateId: vatEnabled ? (defaultRate?.id ?? null) : null,
      today: todayISO(),
    },
  };
}
