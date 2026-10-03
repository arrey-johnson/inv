/**
 * Repository contract used by every server action, page and route handler.
 *
 * Two adapters implement it:
 *   - `supabase/` : production, talks to Postgres through supabase-js (RLS applies)
 *   - `demo/`     : DEMO_MODE, a local JSON file under `.data/` (same rules, no network)
 *
 * Adapters only PERSIST. Business rules (validation, money maths, permissions, state machine)
 * live in `src/lib/documents` and `src/lib/finance` so they are identical in both modes.
 */
import type { AuditEntry } from "@/lib/audit/log";
import type {
  AdvanceLink,
  Attachment,
  AuditLog,
  CreditNoteLink,
  CurrencyCode,
  Customer,
  CustomerType,
  DocumentLink,
  DocumentLinkType,
  DocumentRow,
  DocumentItem,
  DocumentSequence,
  DocumentSequenceCounter,
  DocumentStatus,
  DocumentType,
  DocumentWithholding,
  EmailLog,
  Item,
  ItemType,
  Json,
  Organization,
  OrganizationSettings,
  Payment,
  PaymentAllocation,
  PaymentDestination,
  PaymentMethod,
  TablesInsert,
  TaxRate,
  UserRole,
  WithholdingType,
} from "@/types/database";

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 20;

/** Identity of the signed-in actor (or the demo user). Every repository is bound to one org + actor. */
export interface RepositoryContext {
  organizationId: string;
  userId: string | null;
  userEmail: string | null;
}

// ---------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------
export type ActiveFilter = "active" | "inactive" | "all";

export interface CustomerFilter {
  /** Matches name, email, phone, NIU, RCCM, code, contact. */
  q?: string;
  type?: CustomerType;
  status?: ActiveFilter;
  page?: number;
  pageSize?: number;
}

export type CustomerWrite = Omit<
  Customer,
  "id" | "organization_id" | "created_by" | "created_at" | "updated_at" | "deleted_at"
>;

export interface CustomerRepository {
  list(filter: CustomerFilter): Promise<Page<Customer>>;
  /** Active customers for pickers (capped). */
  listActive(limit?: number): Promise<Customer[]>;
  get(id: string): Promise<Customer | null>;
  create(values: CustomerWrite): Promise<Customer>;
  update(id: string, values: CustomerWrite): Promise<Customer>;
  setActive(id: string, active: boolean): Promise<Customer>;
}

// ---------------------------------------------------------------------------------------------
// Items (products & services)
// ---------------------------------------------------------------------------------------------
export interface ItemFilter {
  q?: string;
  type?: ItemType;
  status?: ActiveFilter;
  page?: number;
  pageSize?: number;
}

export type ItemWrite = Pick<
  Item,
  "item_type" | "sku" | "name" | "description" | "unit" | "unit_price" | "currency" | "tax_rate_id" | "is_active"
>;

export interface ItemRepository {
  list(filter: ItemFilter): Promise<Page<Item>>;
  listActive(limit?: number): Promise<Item[]>;
  get(id: string): Promise<Item | null>;
  create(values: ItemWrite): Promise<Item>;
  update(id: string, values: ItemWrite): Promise<Item>;
  /** Insert items whose SKU does not exist yet. Returns the number created. */
  createManyIfMissing(values: ItemWrite[]): Promise<number>;
}

// ---------------------------------------------------------------------------------------------
// Organization, settings, taxes, payment destinations, numbering, team
// ---------------------------------------------------------------------------------------------
export type OrganizationWrite = Pick<
  Organization,
  | "legal_name"
  | "trade_name"
  | "niu"
  | "rccm"
  | "address_line1"
  | "address_line2"
  | "city"
  | "region"
  | "country"
  | "phone"
  | "email"
  | "website"
>;

export type SettingsPatch = Partial<
  Omit<OrganizationSettings, "organization_id" | "created_at" | "updated_at">
>;

export interface OrganizationRepository {
  get(): Promise<Organization | null>;
  update(values: OrganizationWrite): Promise<Organization>;
  getSettings(): Promise<OrganizationSettings | null>;
  updateSettings(patch: SettingsPatch): Promise<OrganizationSettings>;
}

export type TaxRateWrite = Pick<TaxRate, "code" | "name" | "rate" | "category" | "is_active">;

export interface TaxRepository {
  listRates(): Promise<TaxRate[]>;
  createRate(values: TaxRateWrite): Promise<TaxRate>;
  updateRate(id: string, values: Partial<TaxRateWrite>): Promise<TaxRate>;
  /** Make `id` the only default rate and mirror it into organization_settings.default_tax_rate_id. */
  setDefaultRate(id: string): Promise<void>;
  listWithholdings(): Promise<WithholdingType[]>;
  createWithholding(values: WithholdingTypeWrite): Promise<WithholdingType>;
  updateWithholding(id: string, values: Partial<WithholdingTypeWrite>): Promise<WithholdingType>;
}

export type WithholdingTypeWrite = Pick<WithholdingType, "code" | "name" | "rate" | "base" | "description" | "is_active">;

export type PaymentDestinationWrite = Pick<
  PaymentDestination,
  | "kind"
  | "label"
  | "provider"
  | "account_name"
  | "account_number"
  | "iban"
  | "swift"
  | "is_default"
  | "is_active"
  | "show_on_documents"
>;

export interface PaymentDestinationRepository {
  list(): Promise<PaymentDestination[]>;
  create(values: PaymentDestinationWrite): Promise<PaymentDestination>;
  update(id: string, values: PaymentDestinationWrite): Promise<PaymentDestination>;
  remove(id: string): Promise<void>;
}

export type SequenceWrite = Pick<
  DocumentSequence,
  "prefix" | "separator" | "include_year" | "reset_yearly" | "padding" | "start_number"
>;

export interface SequenceRepository {
  list(): Promise<{ sequences: DocumentSequence[]; counters: DocumentSequenceCounter[] }>;
  update(documentType: DocumentType, values: SequenceWrite): Promise<DocumentSequence>;
}

export interface TeamMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: UserRole;
  isActive: boolean;
  since: string;
}

export interface TeamRepository {
  listMembers(): Promise<TeamMember[]>;
  /** Throws if it would leave the organization without an admin. */
  setRole(userId: string, role: UserRole): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------
export interface DocumentFilter {
  type?: DocumentType;
  /** Several types at once (reports). Combined with `type` when both are given. */
  types?: DocumentType[];
  statuses?: DocumentStatus[];
  customerId?: string;
  /** Inclusive yyyy-MM-dd bounds on issue_date. */
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  /** Invoices past due with an open balance. */
  overdueOnly?: boolean;
  /** Matches the document number or reference. */
  q?: string;
  /** "Today" in yyyy-MM-dd, used by `overdueOnly` (injected so tests are deterministic). */
  today: string;
  page?: number;
  pageSize?: number;
}

export type DocumentListRow = DocumentRow & { customer_name: string };

export type DocumentWrite = Omit<TablesInsert<"documents">, "organization_id">;
export type DocumentItemWrite = Omit<TablesInsert<"document_items">, "organization_id" | "document_id">;
export type DocumentWithholdingWrite = Omit<TablesInsert<"document_withholdings">, "organization_id" | "document_id">;

export interface DraftWrite {
  document: DocumentWrite;
  items: DocumentItemWrite[];
  withholdings: DocumentWithholdingWrite[];
}

export interface DocumentBundle {
  document: DocumentRow;
  items: DocumentItem[];
  withholdings: DocumentWithholding[];
  customer: Customer | null;
}

/** Columns that may change outside the draft editor (workflow only - never money or identity). */
export type DocumentWorkflowPatch = Partial<
  Pick<
    DocumentRow,
    | "status"
    | "approval_status"
    | "approval_requested_by"
    | "approval_requested_at"
    | "approved_by"
    | "approved_at"
    | "approval_note"
    | "sent_at"
  >
>;

export interface StoredPdf {
  sha256: string;
  generatedAt: string;
  bytes: Uint8Array;
}

export type DocumentQuery = Omit<DocumentFilter, "page" | "pageSize">;

export interface PublicLinkWrite {
  hash: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface DocumentRepository {
  list(filter: DocumentFilter): Promise<Page<DocumentListRow>>;
  /** Unpaginated variant for reports and dashboards (capped at 20,000 rows). */
  listAll(filter: DocumentQuery): Promise<DocumentListRow[]>;
  /** Lines of several documents at once (reports: VAT by rate). */
  listItems(documentIds: string[]): Promise<DocumentItem[]>;
  /**
   * Cancel an issued document: status VOID, number kept, reason recorded, balance cleared. The caller
   * (void service) has already checked the business rules; the repository still refuses drafts.
   */
  voidDocument(id: string, reason: string): Promise<DocumentRow>;
  /** Persist OVERDUE on open invoices past their due date with a balance. Returns how many changed. */
  syncOverdue(today: string): Promise<number>;
  /** Store (or with `null` revoke) the hash of the secure public link. The token itself is never stored. */
  setPublicLink(id: string, link: PublicLinkWrite | null): Promise<DocumentRow>;
  findByTokenHash(hash: string): Promise<DocumentRow | null>;
  get(id: string): Promise<DocumentBundle | null>;
  /** Insert a DRAFT. Never allocates a number. */
  insertDraft(write: DraftWrite): Promise<DocumentRow>;
  /** Replace a draft's header + lines. Throws if the document is not a draft. */
  replaceDraft(id: string, write: DraftWrite): Promise<DocumentRow>;
  /**
   * Replace header + lines of an already-issued (non-void) document. Keeps number / issued_at /
   * status stamp; refreshes customer/issuer snapshots; recomputes settlement. Throws for drafts/void.
   */
  replaceIssuedContent(
    id: string,
    write: DraftWrite,
    snapshots: { customerSnapshot: Json; issuerSnapshot: Json },
  ): Promise<DocumentRow>;
  /** Delete a draft. Throws if the document is not a draft. */
  deleteDraft(id: string): Promise<void>;
  patchWorkflow(id: string, patch: DocumentWorkflowPatch): Promise<DocumentRow>;
  /** draft -> issued atomically: validates, snapshots, allocates the official number. */
  issue(id: string): Promise<DocumentRow>;
  /** Persist the generated PDF (private storage) and its SHA-256. */
  storePdf(id: string, pdf: StoredPdf): Promise<void>;
  link(sourceId: string, targetId: string, type: DocumentLinkType): Promise<void>;
  linksFor(id: string): Promise<DocumentLink[]>;
  /** The invoice(s) created from a proforma (excluding deleted drafts). */
  findConvertedInvoices(proformaId: string): Promise<DocumentRow[]>;
}

// ---------------------------------------------------------------------------------------------
// Payments and settlement
// ---------------------------------------------------------------------------------------------
export interface PaymentFilter {
  customerId?: string;
  method?: PaymentMethod;
  /** Inclusive yyyy-MM-dd bounds on payment_date. */
  dateFrom?: string;
  dateTo?: string;
  /** Matches the reference, notes, customer name or an invoice number. */
  q?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export type PaymentAllocationView = PaymentAllocation & { document_number: string | null };
export type PaymentListRow = Payment & { customer_name: string; allocations: PaymentAllocationView[] };
export type PaymentQuery = Omit<PaymentFilter, "page" | "pageSize">;

export interface PaymentWrite {
  customer_id: string;
  payment_date: string;
  amount: number;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  is_adjustment: boolean;
  adjustment_reason: string | null;
  allocations: Array<{ document_id: string; amount: number }>;
}

export interface PaymentDetail {
  payment: Payment;
  customer: Customer | null;
  allocations: Array<{ allocation: PaymentAllocation; document: DocumentRow | null }>;
}

export interface PaymentRepository {
  list(filter: PaymentFilter): Promise<Page<PaymentListRow>>;
  /** Unpaginated, for reports (capped at 20,000 rows). */
  listAll(filter: PaymentQuery): Promise<PaymentListRow[]>;
  get(id: string): Promise<PaymentDetail | null>;
  /**
   * Atomically: insert the payment + allocations and bring every touched invoice up to date
   * (paid amount, balance, status). Re-validates the allocations against the stored balances, so a
   * concurrent payment can never push an invoice past its amount due.
   */
  record(write: PaymentWrite): Promise<{ payment: Payment; documents: DocumentRow[] }>;
  /** Void a payment (kept for the audit trail) and restore the balances of the invoices it paid. */
  void(id: string, reason: string): Promise<{ payment: Payment; documents: DocumentRow[] }>;
  /** Non-voided payments applied to a document, newest first. */
  forDocument(documentId: string): Promise<Array<{ payment: Payment; allocation: PaymentAllocation }>>;
}

export interface SettlementRepository {
  creditLinks(filter?: { invoiceId?: string; creditNoteId?: string }): Promise<CreditNoteLink[]>;
  advanceLinks(filter?: { invoiceId?: string; advanceId?: string }): Promise<AdvanceLink[]>;
  /** Apply an issued credit note to its invoice and refresh the invoice settlement/status. */
  applyCreditNote(link: { creditNoteId: string; invoiceId: string; amount: number }): Promise<DocumentRow>;
  /** Remove the applications of a credit note (it was cancelled) and refresh the invoices. */
  releaseCreditNote(creditNoteId: string): Promise<DocumentRow[]>;
  /** Deduct (part of) a paid advance from a final invoice and refresh the invoice. */
  applyAdvance(link: {
    advanceId: string;
    invoiceId: string;
    amount: number;
    htAmount: number;
    vatAmount: number;
  }): Promise<DocumentRow>;
}

// ---------------------------------------------------------------------------------------------
// Email log, attachments, audit trail
// ---------------------------------------------------------------------------------------------
export type EmailLogWrite = Omit<EmailLog, "id" | "organization_id" | "created_at">;

export interface EmailLogRepository {
  add(log: EmailLogWrite): Promise<EmailLog>;
  listForDocument(documentId: string): Promise<EmailLog[]>;
}

export interface AttachmentWrite {
  entityType: Attachment["entity_type"];
  entityId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface AttachmentRepository {
  add(write: AttachmentWrite): Promise<Attachment>;
  listFor(entityType: Attachment["entity_type"], entityId: string): Promise<Attachment[]>;
  read(id: string): Promise<{ attachment: Attachment; bytes: Uint8Array } | null>;
}

export interface AuditRepository {
  /** Newest first. Entries whose `entity_id` is one of `entityIds`. */
  list(filter: { entityIds: string[]; limit?: number }): Promise<AuditLog[]>;
}

// ---------------------------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------------------------
export interface Repository {
  readonly mode: "demo" | "supabase";
  readonly context: RepositoryContext;
  organization: OrganizationRepository;
  customers: CustomerRepository;
  items: ItemRepository;
  taxes: TaxRepository;
  paymentDestinations: PaymentDestinationRepository;
  sequences: SequenceRepository;
  team: TeamRepository;
  documents: DocumentRepository;
  payments: PaymentRepository;
  settlement: SettlementRepository;
  emailLogs: EmailLogRepository;
  attachments: AttachmentRepository;
  audit: AuditRepository;
  writeAudit(entry: Omit<AuditEntry, "organizationId" | "actorId" | "actorEmail">): Promise<void>;
}

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid" | "immutable" | "forbidden" = "invalid",
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
