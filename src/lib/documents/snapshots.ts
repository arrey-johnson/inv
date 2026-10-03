import type {
  Customer,
  Json,
  Organization,
  OrganizationSettings,
  PaymentDestination,
} from "@/types/database";

/**
 * Frozen copies stored on a document at issue time. The SQL `issue_document()` builds the same
 * shapes (00011); the demo adapter uses these functions. Keep the keys in sync.
 */
export function buildCustomerSnapshot(customer: Customer): Json {
  return {
    id: customer.id,
    name: customer.name,
    customer_type: customer.customer_type,
    contact_name: customer.contact_name,
    email: customer.email,
    phone: customer.phone,
    address_line1: customer.address_line1,
    address_line2: customer.address_line2,
    city: customer.city,
    region: customer.region,
    country: customer.country,
    niu: customer.niu,
    rccm: customer.rccm,
  };
}

export function buildIssuerSnapshot(
  org: Organization,
  settings: OrganizationSettings | null,
  destinations: ReadonlyArray<PaymentDestination>,
): Json {
  const printable = destinations
    .filter((d) => d.is_active && d.show_on_documents)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order)
    .map((d) => ({
      kind: d.kind,
      label: d.label,
      provider: d.provider,
      account_name: d.account_name,
      account_number: d.account_number,
      iban: d.iban,
      swift: d.swift,
    }));

  return {
    id: org.id,
    legal_name: org.legal_name,
    trade_name: org.trade_name,
    niu: org.niu,
    rccm: org.rccm,
    address_line1: org.address_line1,
    address_line2: org.address_line2,
    city: org.city,
    region: org.region,
    country: org.country,
    phone: org.phone,
    email: org.email,
    website: org.website,
    bank_name: settings?.bank_name ?? null,
    bank_account_name: settings?.bank_account_name ?? null,
    bank_account_number: settings?.bank_account_number ?? null,
    bank_iban: settings?.bank_iban ?? null,
    bank_swift: settings?.bank_swift ?? null,
    mobile_money_number: settings?.mobile_money_number ?? null,
    payment_destinations: printable,
    signatory_name: settings?.signatory_name ?? null,
    signatory_position: settings?.signatory_position ?? null,
  };
}
