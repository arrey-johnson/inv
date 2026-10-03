/**
 * Database types - hand-maintained to match `supabase/migrations/*.sql`.
 *
 * Once the Supabase project exists, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.generated.ts
 * and switch the imports over. Until then this file is the single source of truth for the shape
 * of rows used by the app. NUMERIC columns are typed as `number` (PostgREST returns JSON numbers).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ---------------------------------------------------------------------------------------------
// Enums (00001_enums.sql)
// ---------------------------------------------------------------------------------------------
export const DOCUMENT_TYPES = ["invoice", "proforma", "credit_note", "receipt", "advance"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  "draft",
  "issued",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "converted",
  "partially_paid",
  "paid",
  "overdue",
  "credited",
  "void",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "cheque",
  "mtn_momo",
  "orange_money",
  "card",
  "other",
  /** Legacy generic value from Phase 1 (no provider). Kept so old data stays valid; not offered for new payments. */
  "mobile_money",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CUSTOMER_TYPES = ["individual", "company", "government", "ngo"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const TAX_CATEGORIES = ["standard", "reduced", "zero_rated", "exempt"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const USER_ROLES = ["admin", "accountant", "sales", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DISCOUNT_TYPES = ["none", "percentage", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const ITEM_TYPES = ["product", "service"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const CURRENCY_CODES = ["XAF", "EUR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export type WithholdingBase = "net_ht" | "total_ttc";
export type BrandAssetKind = "letterhead" | "stamp" | "logo" | "signature";
export type EmailStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";
export type SubmissionStatus = "pending" | "submitted" | "accepted" | "rejected" | "failed";
export type RecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type DocumentLinkType =
  | "converted_to"
  | "credit_for"
  | "advance_for"
  | "receipt_for"
  | "revision_of"
  | "duplicate_of";

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------
type ISODateTime = string; // timestamptz
type ISODate = string; // date (yyyy-MM-dd)
type UUID = string;

export type Organization = {
  id: UUID;
  legal_name: string;
  trade_name: string | null;
  niu: string | null;
  rccm: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type OrganizationSettings = {
  organization_id: UUID;
  default_currency: CurrencyCode;
  timezone: string;
  locale: string;
  vat_registered: boolean;
  default_tax_rate_id: UUID | null;
  default_payment_terms_days: number;
  proforma_validity_days: number;
  default_invoice_notes: string | null;
  default_invoice_terms: string | null;
  default_proforma_notes: string | null;
  default_proforma_terms: string | null;
  show_amount_in_words: boolean;
  stamp_enabled: boolean;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_iban: string | null;
  bank_swift: string | null;
  mobile_money_number: string | null;
  enabled_payment_methods: PaymentMethod[];
  fiscal_year_start_month: number;
  /** 00011: documents must be approved before issue. */
  require_approval: boolean;
  signatory_name: string | null;
  signatory_position: string | null;
  /** 00011: stamp placement overrides in PDF points (null = renderer default). */
  stamp_x: number | null;
  stamp_y: number | null;
  stamp_width: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export const PAYMENT_DESTINATION_KINDS = ["bank", "mobile_money"] as const;
export type PaymentDestinationKind = (typeof PAYMENT_DESTINATION_KINDS)[number];

export type PaymentDestination = {
  id: UUID;
  organization_id: UUID;
  kind: PaymentDestinationKind;
  label: string;
  provider: string | null;
  account_name: string | null;
  account_number: string | null;
  iban: string | null;
  swift: string | null;
  is_default: boolean;
  is_active: boolean;
  show_on_documents: boolean;
  sort_order: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export const APPROVAL_STATUSES = ["none", "pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type BrandAsset = {
  id: UUID;
  organization_id: UUID;
  kind: BrandAssetKind;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number | null;
  sha256: string | null;
  version: number;
  is_active: boolean;
  uploaded_by: UUID | null;
  created_at: ISODateTime;
}

export type Profile = {
  id: UUID;
  organization_id: UUID | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_path: string | null;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type UserRoleRow = {
  id: UUID;
  user_id: UUID;
  organization_id: UUID;
  role: UserRole;
  created_by: UUID | null;
  created_at: ISODateTime;
}

export type Customer = {
  id: UUID;
  organization_id: UUID;
  customer_type: CustomerType;
  code: string | null;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  country: string;
  niu: string | null;
  rccm: string | null;
  default_currency: CurrencyCode;
  payment_terms_days: number | null;
  default_withholding_type_id: UUID | null;
  notes: string | null;
  is_active: boolean;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null;
}

export type Item = {
  id: UUID;
  organization_id: UUID;
  item_type: ItemType;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  unit_price: number;
  currency: CurrencyCode;
  tax_rate_id: UUID | null;
  is_active: boolean;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null;
}

export type TaxRate = {
  id: UUID;
  organization_id: UUID;
  code: string;
  name: string;
  rate: number;
  category: TaxCategory;
  is_default: boolean;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type WithholdingType = {
  id: UUID;
  organization_id: UUID;
  code: string;
  name: string;
  rate: number;
  base: WithholdingBase;
  description: string | null;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type DocumentSequence = {
  id: UUID;
  organization_id: UUID;
  document_type: DocumentType;
  prefix: string;
  separator: string;
  include_year: boolean;
  reset_yearly: boolean;
  padding: number;
  start_number: number;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type DocumentSequenceCounter = {
  organization_id: UUID;
  document_type: DocumentType;
  sequence_year: number;
  last_number: number;
  updated_at: ISODateTime;
}

export type DocumentRow = {
  id: UUID;
  organization_id: UUID;
  document_type: DocumentType;
  status: DocumentStatus;
  number: string | null;
  customer_id: UUID;
  customer_snapshot: Json | null;
  issuer_snapshot: Json | null;
  issue_date: ISODate;
  due_date: ISODate | null;
  valid_until: ISODate | null;
  currency: CurrencyCode;
  reference: string | null;
  subject: string | null;
  notes: string | null;
  terms: string | null;
  internal_notes: string | null;
  global_discount_type: DiscountType;
  global_discount_value: number;
  subtotal: number;
  line_discount_total: number;
  global_discount_amount: number;
  net_ht: number;
  tax_total: number;
  total_ttc: number;
  withholding_total: number;
  net_payable: number;
  paid_amount: number;
  credited_amount: number;
  advance_applied_amount: number;
  balance_due: number;
  issued_at: ISODateTime | null;
  issued_by: UUID | null;
  sent_at: ISODateTime | null;
  voided_at: ISODateTime | null;
  voided_by: UUID | null;
  void_reason: string | null;
  converted_from_document_id: UUID | null;
  public_token_hash: string | null;
  public_token_created_at: ISODateTime | null;
  public_token_expires_at: ISODateTime | null;
  public_token_revoked_at: ISODateTime | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  pdf_generated_at: ISODateTime | null;
  /** 00011: approval workflow metadata (drafts only; issued documents keep the final value). */
  approval_status: ApprovalStatus;
  approval_requested_by: UUID | null;
  approval_requested_at: ISODateTime | null;
  approved_by: UUID | null;
  approved_at: ISODateTime | null;
  approval_note: string | null;
  created_by: UUID | null;
  updated_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null;
}

export type DocumentItem = {
  id: UUID;
  organization_id: UUID;
  document_id: UUID;
  position: number;
  item_id: UUID | null;
  description: string;
  details: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_type: DiscountType;
  discount_value: number;
  tax_rate_id: UUID | null;
  tax_rate: number;
  tax_category: TaxCategory;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  global_discount_share: number;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
  /** 00012: on a credit note line, the invoice line it credits (quantity tracking). */
  credit_source_item_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type DocumentWithholding = {
  id: UUID;
  organization_id: UUID;
  document_id: UUID;
  withholding_type_id: UUID | null;
  code: string;
  name: string;
  rate: number;
  base: WithholdingBase;
  base_amount: number;
  amount: number;
  created_at: ISODateTime;
}

export type Payment = {
  id: UUID;
  organization_id: UUID;
  customer_id: UUID;
  payment_date: ISODate;
  amount: number;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  receipt_document_id: UUID | null;
  /** 00012: an audited administrator adjustment (e.g. settlement outside the system), not a cash receipt. */
  is_adjustment: boolean;
  adjustment_reason: string | null;
  received_by: UUID | null;
  voided_at: ISODateTime | null;
  voided_by: UUID | null;
  void_reason: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type PaymentAllocation = {
  id: UUID;
  organization_id: UUID;
  payment_id: UUID;
  document_id: UUID;
  amount: number;
  created_by: UUID | null;
  created_at: ISODateTime;
}

export type CreditNoteLink = {
  id: UUID;
  organization_id: UUID;
  credit_note_id: UUID;
  invoice_id: UUID;
  amount: number;
  created_by: UUID | null;
  created_at: ISODateTime;
}

export type AdvanceLink = {
  id: UUID;
  organization_id: UUID;
  advance_document_id: UUID;
  invoice_id: UUID;
  /** TTC amount of the advance deducted from the final invoice. */
  amount: number;
  /** 00012: the HT / VAT parts of `amount` (VAT already declared on the advance is not charged twice). */
  ht_amount: number;
  vat_amount: number;
  created_by: UUID | null;
  created_at: ISODateTime;
}

export type DocumentLink = {
  id: UUID;
  organization_id: UUID;
  source_document_id: UUID;
  target_document_id: UUID;
  link_type: DocumentLinkType;
  created_by: UUID | null;
  created_at: ISODateTime;
}

export type Attachment = {
  id: UUID;
  organization_id: UUID;
  entity_type: "document" | "customer" | "payment" | "item";
  entity_id: UUID;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_by: UUID | null;
  created_at: ISODateTime;
}

export type EmailLog = {
  id: UUID;
  organization_id: UUID;
  document_id: UUID | null;
  customer_id: UUID | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  template: string | null;
  status: EmailStatus;
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  sent_by: UUID | null;
  sent_at: ISODateTime | null;
  created_at: ISODateTime;
}

export type AuditLog = {
  id: number;
  organization_id: UUID | null;
  actor_id: UUID | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Json | null;
  after_data: Json | null;
  metadata: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: ISODateTime;
}

export type RecurringSchedule = {
  id: UUID;
  organization_id: UUID;
  customer_id: UUID;
  template_document_id: UUID;
  frequency: RecurrenceFrequency;
  interval_count: number;
  start_date: ISODate;
  end_date: ISODate | null;
  next_run_date: ISODate;
  last_run_at: ISODateTime | null;
  auto_issue: boolean;
  auto_send: boolean;
  is_active: boolean;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type TaxAuthoritySubmission = {
  id: UUID;
  organization_id: UUID;
  document_id: UUID;
  authority: string;
  status: SubmissionStatus;
  attempts: number;
  external_reference: string | null;
  request_payload: Json | null;
  response_payload: Json | null;
  error_message: string | null;
  submitted_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---------------------------------------------------------------------------------------------
// supabase-js `Database` generic
// ---------------------------------------------------------------------------------------------
type Table<Row, RequiredInsert extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, RequiredInsert> & Partial<Omit<Row, RequiredInsert>>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      organizations: Table<Organization, "legal_name">;
      organization_settings: Table<OrganizationSettings, "organization_id">;
      payment_destinations: Table<PaymentDestination, "organization_id" | "kind" | "label">;
      brand_assets: Table<BrandAsset, "organization_id" | "kind" | "storage_path" | "file_name" | "mime_type">;
      profiles: Table<Profile, "id">;
      user_roles: Table<UserRoleRow, "user_id" | "organization_id" | "role">;
      customers: Table<Customer, "organization_id" | "name">;
      items: Table<Item, "organization_id" | "name">;
      tax_rates: Table<TaxRate, "organization_id" | "code" | "name" | "rate">;
      withholding_types: Table<WithholdingType, "organization_id" | "code" | "name" | "rate">;
      document_sequences: Table<DocumentSequence, "organization_id" | "document_type" | "prefix">;
      document_sequence_counters: Table<
        DocumentSequenceCounter,
        "organization_id" | "document_type" | "sequence_year" | "last_number"
      >;
      documents: Table<DocumentRow, "organization_id" | "document_type" | "customer_id">;
      document_items: Table<
        DocumentItem,
        "organization_id" | "document_id" | "position" | "description" | "quantity" | "unit_price"
      >;
      document_withholdings: Table<
        DocumentWithholding,
        "organization_id" | "document_id" | "code" | "name" | "rate" | "base_amount" | "amount"
      >;
      payments: Table<Payment, "organization_id" | "customer_id" | "amount" | "method">;
      payment_allocations: Table<PaymentAllocation, "organization_id" | "payment_id" | "document_id" | "amount">;
      credit_note_links: Table<CreditNoteLink, "organization_id" | "credit_note_id" | "invoice_id" | "amount">;
      advance_links: Table<AdvanceLink, "organization_id" | "advance_document_id" | "invoice_id" | "amount">;
      document_links: Table<
        DocumentLink,
        "organization_id" | "source_document_id" | "target_document_id" | "link_type"
      >;
      attachments: Table<
        Attachment,
        "organization_id" | "entity_type" | "entity_id" | "storage_path" | "file_name"
      >;
      email_logs: Table<EmailLog, "organization_id" | "to_emails" | "subject">;
      audit_logs: Table<AuditLog, "action" | "entity_type">;
      recurring_schedules: Table<
        RecurringSchedule,
        "organization_id" | "customer_id" | "template_document_id" | "frequency" | "start_date" | "next_run_date"
      >;
      tax_authority_submissions: Table<TaxAuthoritySubmission, "organization_id" | "document_id">;
    };
    Views: Record<string, never>;
    Functions: {
      allocate_document_number: {
        Args: { p_org_id: UUID; p_doc_type: DocumentType; p_issue_year: number };
        Returns: string;
      };
      issue_document: {
        Args: { p_document_id: UUID };
        Returns: DocumentRow;
      };
      recompute_document_settlement: {
        Args: { p_document_id: UUID };
        Returns: undefined;
      };
      // 00012 (Phase 3-5). Each runs in one transaction and recomputes the touched invoices.
      record_payment: {
        Args: {
          p_customer_id: UUID;
          p_payment_date: ISODate;
          p_amount: number;
          p_currency: CurrencyCode;
          p_method: PaymentMethod;
          p_reference: string | null;
          p_notes: string | null;
          p_is_adjustment: boolean;
          p_adjustment_reason: string | null;
          p_allocations: Json;
        };
        Returns: UUID;
      };
      void_payment: { Args: { p_payment_id: UUID; p_reason: string }; Returns: undefined };
      apply_credit_note: { Args: { p_credit_note_id: UUID; p_invoice_id: UUID; p_amount: number }; Returns: undefined };
      release_credit_note: { Args: { p_credit_note_id: UUID }; Returns: undefined };
      apply_advance: {
        Args: { p_advance_id: UUID; p_invoice_id: UUID; p_amount: number; p_ht_amount: number; p_vat_amount: number };
        Returns: undefined;
      };
      void_document: { Args: { p_document_id: UUID; p_reason: string }; Returns: DocumentRow };
      sync_overdue: { Args: { p_today: ISODate }; Returns: number };
      is_org_member: { Args: { p_org: UUID }; Returns: boolean };
      has_org_role: { Args: { p_org: UUID; p_roles: UserRole[] }; Returns: boolean };
      current_org_id: { Args: Record<string, never>; Returns: UUID | null };
    };
    Enums: {
      document_type: DocumentType;
      document_status: DocumentStatus;
      payment_method: PaymentMethod;
      customer_type: CustomerType;
      tax_category: TaxCategory;
      user_role: UserRole;
      discount_type: DiscountType;
      item_type: ItemType;
      currency_code: CurrencyCode;
      withholding_base: WithholdingBase;
      brand_asset_kind: BrandAssetKind;
      email_status: EmailStatus;
      submission_status: SubmissionStatus;
      recurrence_frequency: RecurrenceFrequency;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
