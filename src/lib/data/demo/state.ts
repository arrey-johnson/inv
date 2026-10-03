import { randomUUID } from "node:crypto";
import { starterCatalogWrites } from "@/lib/catalog/starter-catalog";
import type { TeamMember } from "@/lib/data/types";
import type {
  AdvanceLink,
  Attachment,
  AuditLog,
  CreditNoteLink,
  Customer,
  DocumentItem,
  DocumentLink,
  DocumentRow,
  DocumentSequence,
  DocumentSequenceCounter,
  DocumentType,
  DocumentWithholding,
  EmailLog,
  Item,
  Organization,
  OrganizationSettings,
  Payment,
  PaymentAllocation,
  PaymentDestination,
  TaxRate,
  WithholdingType,
} from "@/types/database";

export const DEMO_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_USER_ID = "00000000-0000-4000-8000-0000000000d1";
export const DEMO_USER_EMAIL = "demo@promptstack.local";

/** Everything the demo repository persists. Mirrors the Postgres tables it stands in for. */
export interface DemoState {
  version: 1;
  organization: Organization;
  settings: OrganizationSettings;
  members: TeamMember[];
  customers: Customer[];
  items: Item[];
  tax_rates: TaxRate[];
  withholding_types: WithholdingType[];
  payment_destinations: PaymentDestination[];
  document_sequences: DocumentSequence[];
  document_sequence_counters: DocumentSequenceCounter[];
  documents: DocumentRow[];
  document_items: DocumentItem[];
  document_withholdings: DocumentWithholding[];
  document_links: DocumentLink[];
  payments: Payment[];
  payment_allocations: PaymentAllocation[];
  credit_note_links: CreditNoteLink[];
  advance_links: AdvanceLink[];
  email_logs: EmailLog[];
  attachments: Attachment[];
  audit_logs: AuditLog[];
}

/**
 * Databases written by an earlier phase lack the newer collections. Fill them in so an existing
 * `.data/demo-db.json` keeps working after an upgrade (no reset needed).
 */
export function normalizeState(raw: DemoState): DemoState {
  raw.payments ??= [];
  raw.payment_allocations ??= [];
  raw.credit_note_links ??= [];
  raw.advance_links ??= [];
  raw.email_logs ??= [];
  raw.attachments ??= [];
  raw.withholding_types ??= [];
  return raw;
}

const SEQUENCE_PREFIXES: Record<DocumentType, string> = {
  invoice: "PS-INV",
  proforma: "PS-PF",
  credit_note: "PS-CN",
  receipt: "PS-RCP",
  advance: "PS-ADV",
};

/**
 * Initial demo data. Mirrors 00009_seed_defaults.sql: legal identifiers (NIU, RCCM), address and bank
 * details are NULL - nothing about Promptstack is invented. Only the catalog carries fictional
 * sample prices, and only in demo mode.
 */
export function createSeedState(now: Date = new Date()): DemoState {
  const ts = now.toISOString();
  const standardVat: TaxRate = {
    id: randomUUID(),
    organization_id: DEMO_ORGANIZATION_ID,
    code: "VAT_STD",
    name: "Standard VAT",
    rate: 19.25,
    category: "standard",
    is_default: true,
    is_active: true,
    created_at: ts,
    updated_at: ts,
  };
  const exempt: TaxRate = {
    ...standardVat,
    id: randomUUID(),
    code: "VAT_EXEMPT",
    name: "Exempt",
    rate: 0,
    category: "exempt",
    is_default: false,
  };

  const organization: Organization = {
    id: DEMO_ORGANIZATION_ID,
    legal_name: "Promptstack Technologies",
    trade_name: "Promptstack",
    niu: "M092618963164E",
    rccm: "CM-DLA-01-2026-B12-00758",
    address_line1: "Rue Copseco, Bonapriso",
    address_line2: null,
    city: "Douala",
    region: null,
    country: "Cameroon",
    phone: null,
    email: "hello@promptstacktechnologies.com",
    website: null,
    is_active: true,
    created_at: ts,
    updated_at: ts,
  };

  const accessBankNote =
    "Bank transfer to Access Bank Cameroon Plc (PROMPTSTACK TECHNOLOGIES).\n" +
    "IBAN: CM21 10041 00001 00101301472 73 · SWIFT: ABNGCMCX\n" +
    "Cheques payable to Promptstack Technologies.";

  const settings: OrganizationSettings = {
    organization_id: DEMO_ORGANIZATION_ID,
    default_currency: "XAF",
    timezone: "Africa/Douala",
    locale: "en",
    vat_registered: true,
    default_tax_rate_id: standardVat.id,
    default_payment_terms_days: 30,
    proforma_validity_days: 30,
    default_invoice_notes: accessBankNote,
    default_invoice_terms: null,
    default_proforma_notes: accessBankNote,
    default_proforma_terms: null,
    show_amount_in_words: true,
    stamp_enabled: true,
    bank_name: "Access Bank Cameroon Plc",
    bank_account_name: "PROMPTSTACK TECHNOLOGIES",
    bank_account_number: "10041 00001 00101301472 73",
    bank_iban: "CM21 10041 00001 00101301472 73",
    bank_swift: "ABNGCMCX",
    mobile_money_number: null,
    enabled_payment_methods: ["bank_transfer", "cheque", "cash", "mtn_momo", "orange_money", "card", "other"],
    fiscal_year_start_month: 1,
    require_approval: false,
    signatory_name: null,
    signatory_position: null,
    stamp_x: null,
    stamp_y: null,
    stamp_width: null,
    created_at: ts,
    updated_at: ts,
  };

  const accessBank: PaymentDestination = {
    id: randomUUID(),
    organization_id: DEMO_ORGANIZATION_ID,
    kind: "bank",
    label: "Access Bank Cameroon Plc",
    provider: "Access Bank Cameroon Plc",
    account_name: "PROMPTSTACK TECHNOLOGIES",
    account_number: "10041 00001 00101301472 73",
    iban: "CM21 10041 00001 00101301472 73",
    swift: "ABNGCMCX",
    is_default: true,
    is_active: true,
    show_on_documents: true,
    sort_order: 0,
    created_at: ts,
    updated_at: ts,
  };

  const sequences: DocumentSequence[] = (Object.keys(SEQUENCE_PREFIXES) as DocumentType[]).map((type) => ({
    id: randomUUID(),
    organization_id: DEMO_ORGANIZATION_ID,
    document_type: type,
    prefix: SEQUENCE_PREFIXES[type],
    separator: "-",
    include_year: true,
    reset_yearly: true,
    padding: 4,
    start_number: 1,
    is_active: true,
    created_at: ts,
    updated_at: ts,
  }));

  const items: Item[] = starterCatalogWrites({ withDemoPrices: true, taxRateId: standardVat.id }).map(
    (write) => ({
      ...write,
      id: randomUUID(),
      organization_id: DEMO_ORGANIZATION_ID,
      created_by: DEMO_USER_ID,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    }),
  );

  const members: TeamMember[] = [
    { userId: DEMO_USER_ID, email: DEMO_USER_EMAIL, fullName: "Demo Admin", role: "admin", isActive: true, since: ts },
    { userId: randomUUID(), email: "accountant@promptstack.local", fullName: "Demo Accountant", role: "accountant", isActive: true, since: ts },
    { userId: randomUUID(), email: "sales@promptstack.local", fullName: "Demo Sales", role: "sales", isActive: true, since: ts },
    { userId: randomUUID(), email: "viewer@promptstack.local", fullName: "Demo Viewer", role: "viewer", isActive: true, since: ts },
  ];

  return {
    version: 1,
    organization,
    settings,
    members,
    customers: [],
    items,
    tax_rates: [standardVat, exempt],
    withholding_types: [],
    payment_destinations: [accessBank],
    document_sequences: sequences,
    document_sequence_counters: [],
    documents: [],
    document_items: [],
    document_withholdings: [],
    document_links: [],
    payments: [],
    payment_allocations: [],
    credit_note_links: [],
    advance_links: [],
    email_logs: [],
    attachments: [],
    audit_logs: [],
  };
}
