-- =============================================================================
-- 00004_documents.sql
-- Numbering, documents, line items, withholdings.
-- One `documents` table holds invoices, proformas, credit notes, receipts and advances.
-- =============================================================================

-- document_sequences: numbering CONFIG (one row per organization + document type) --------------
create table public.document_sequences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  document_type    public.document_type not null,
  prefix           text not null check (length(btrim(prefix)) > 0),   -- e.g. PS-INV
  separator        text not null default '-',
  include_year     boolean not null default true,
  reset_yearly     boolean not null default true,
  padding          smallint not null default 4 check (padding between 1 and 12),
  start_number     integer not null default 1 check (start_number >= 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, document_type)
);
create trigger trg_document_sequences_updated_at before update on public.document_sequences
  for each row execute function public.set_updated_at();

-- document_sequence_counters: the actual counters (one row per org + type + year) --------------
-- sequence_year = 0 is used when reset_yearly is false.
-- Rows are only ever modified by allocate_document_number() (SECURITY DEFINER).
create table public.document_sequence_counters (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  document_type    public.document_type not null,
  sequence_year    integer not null check (sequence_year = 0 or sequence_year between 2000 and 2999),
  last_number      integer not null check (last_number >= 0),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, document_type, sequence_year)
);

-- documents ---------------------------------------------------------------------------------------
create table public.documents (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  document_type            public.document_type not null,
  status                   public.document_status not null default 'draft',
  -- Allocated at issue time (see issue_document()). NULL while draft.
  number                   text,
  customer_id              uuid not null references public.customers(id) on delete restrict,
  -- Frozen copies taken at issue time so later edits to customer/company never alter history.
  customer_snapshot        jsonb,
  issuer_snapshot          jsonb,
  issue_date               date not null default current_date,
  due_date                 date,
  valid_until              date,                              -- proformas
  currency                 public.currency_code not null default 'XAF',
  reference                text,                              -- customer PO / reference
  subject                  text,
  notes                    text,
  terms                    text,
  internal_notes           text,
  -- Discounts & totals. Computed by src/lib/finance/calculate-document.ts and persisted.
  global_discount_type     public.discount_type not null default 'none',
  global_discount_value    numeric(18,4) not null default 0 check (global_discount_value >= 0),
  subtotal                 numeric(18,2) not null default 0 check (subtotal >= 0),         -- after line discounts
  line_discount_total      numeric(18,2) not null default 0 check (line_discount_total >= 0),
  global_discount_amount   numeric(18,2) not null default 0 check (global_discount_amount >= 0),
  net_ht                   numeric(18,2) not null default 0 check (net_ht >= 0),
  tax_total                numeric(18,2) not null default 0 check (tax_total >= 0),
  total_ttc                numeric(18,2) not null default 0 check (total_ttc >= 0),
  withholding_total        numeric(18,2) not null default 0 check (withholding_total >= 0),
  net_payable              numeric(18,2) not null default 0 check (net_payable >= 0),
  -- Settlement (maintained by recompute_document_settlement(); invoices only)
  paid_amount              numeric(18,2) not null default 0 check (paid_amount >= 0),
  credited_amount          numeric(18,2) not null default 0 check (credited_amount >= 0),
  advance_applied_amount   numeric(18,2) not null default 0 check (advance_applied_amount >= 0),
  balance_due              numeric(18,2) not null default 0 check (balance_due >= 0),
  -- Workflow timestamps
  issued_at                timestamptz,
  issued_by                uuid,
  sent_at                  timestamptz,
  voided_at                timestamptz,
  voided_by                uuid,
  void_reason              text,
  -- Proforma -> invoice conversion
  converted_from_document_id uuid references public.documents(id) on delete set null,
  -- Secure public link (document/[token]). Only the SHA-256 hash of the token is stored.
  public_token_hash        text,
  public_token_created_at  timestamptz,
  public_token_expires_at  timestamptz,
  public_token_revoked_at  timestamptz,
  -- Rendered PDF (private storage bucket `documents`)
  pdf_storage_path         text,
  pdf_sha256               text,
  pdf_generated_at         timestamptz,
  created_by               uuid,
  updated_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint documents_number_required check (status = 'draft' or number is not null),
  constraint documents_due_after_issue check (due_date is null or due_date >= issue_date),
  constraint documents_valid_until_after_issue check (valid_until is null or valid_until >= issue_date),
  constraint documents_net_payable_consistent check (net_payable <= total_ttc),
  constraint documents_void_has_reason check (status <> 'void' or voided_at is not null)
);

create unique index documents_org_number_uidx on public.documents (organization_id, number) where number is not null;
create unique index documents_public_token_uidx on public.documents (public_token_hash) where public_token_hash is not null;
create index documents_org_type_status_idx on public.documents (organization_id, document_type, status) where deleted_at is null;
create index documents_org_customer_idx on public.documents (organization_id, customer_id) where deleted_at is null;
create index documents_org_issue_date_idx on public.documents (organization_id, issue_date desc) where deleted_at is null;
create index documents_org_due_date_open_idx on public.documents (organization_id, due_date)
  where deleted_at is null and document_type = 'invoice' and status in ('issued','sent','partially_paid','overdue');
create index documents_converted_from_idx on public.documents (converted_from_document_id) where converted_from_document_id is not null;
create index documents_created_by_idx on public.documents (created_by);
create trigger trg_documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- document_items --------------------------------------------------------------------------------------
create table public.document_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  document_id           uuid not null references public.documents(id) on delete cascade,
  position              integer not null check (position >= 1),
  item_id               uuid references public.items(id) on delete set null,
  description           text not null check (length(btrim(description)) > 0),
  details               text,
  quantity              numeric(18,4) not null check (quantity >= 0),
  unit                  text,
  unit_price            numeric(18,4) not null check (unit_price >= 0),
  discount_type         public.discount_type not null default 'none',
  discount_value        numeric(18,4) not null default 0 check (discount_value >= 0),
  tax_rate_id           uuid references public.tax_rates(id) on delete set null,
  -- snapshot of the rate at the time of writing the line
  tax_rate              numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  tax_category          public.tax_category not null default 'standard',
  -- computed amounts (see calculate-document.ts)
  gross_amount          numeric(18,2) not null default 0 check (gross_amount >= 0),
  discount_amount       numeric(18,2) not null default 0 check (discount_amount >= 0),
  net_amount            numeric(18,2) not null default 0 check (net_amount >= 0),
  global_discount_share numeric(18,2) not null default 0 check (global_discount_share >= 0),
  taxable_amount        numeric(18,2) not null default 0 check (taxable_amount >= 0),
  tax_amount            numeric(18,2) not null default 0 check (tax_amount >= 0),
  total_amount          numeric(18,2) not null default 0 check (total_amount >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (document_id, position)
);
create index document_items_document_idx on public.document_items (document_id, position);
create index document_items_item_idx on public.document_items (item_id) where item_id is not null;
create index document_items_org_idx on public.document_items (organization_id);
create trigger trg_document_items_updated_at before update on public.document_items
  for each row execute function public.set_updated_at();

-- document_withholdings ---------------------------------------------------------------------------------
create table public.document_withholdings (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  document_id          uuid not null references public.documents(id) on delete cascade,
  withholding_type_id  uuid references public.withholding_types(id) on delete set null,
  code                 text not null,
  name                 text not null,
  rate                 numeric(7,4) not null check (rate >= 0 and rate <= 100),
  base                 public.withholding_base not null default 'net_ht',
  base_amount          numeric(18,2) not null check (base_amount >= 0),
  amount               numeric(18,2) not null check (amount >= 0),
  created_at           timestamptz not null default now()
);
create index document_withholdings_document_idx on public.document_withholdings (document_id);
create index document_withholdings_org_idx on public.document_withholdings (organization_id);
