-- =============================================================================
-- 00001_enums.sql
-- Extensions and enum types for the Promptstack invoicing system.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Document kinds. Sequence prefixes: invoice PS-INV, proforma PS-PF, credit_note PS-CN,
-- receipt PS-RCP, advance PS-ADV.
create type public.document_type as enum (
  'invoice',
  'proforma',
  'credit_note',
  'receipt',
  'advance'
);

-- Lifecycle of a document. `draft` is the only editable state; `void` is terminal.
-- Proforma-specific: accepted / rejected / expired / converted.
-- Invoice-specific: partially_paid / paid / overdue (derived by recompute_document_settlement()).
create type public.document_status as enum (
  'draft',
  'issued',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'partially_paid',
  'paid',
  'overdue',
  'void'
);

create type public.payment_method as enum (
  'cash',
  'bank_transfer',
  'mobile_money',
  'cheque',
  'card',
  'other'
);

create type public.customer_type as enum (
  'individual',
  'company',
  'government',
  'ngo'
);

create type public.tax_category as enum (
  'standard',
  'reduced',
  'zero_rated',
  'exempt'
);

-- admin: everything. accountant: finance + read settings. sales: customers/items/draft documents.
-- viewer: read only. Mirrors src/lib/auth/rbac.ts.
create type public.user_role as enum (
  'admin',
  'accountant',
  'sales',
  'viewer'
);

create type public.discount_type as enum (
  'none',
  'percentage',
  'fixed'
);

create type public.item_type as enum (
  'product',
  'service'
);

create type public.currency_code as enum (
  'XAF',
  'EUR',
  'USD'
);

-- Supporting enums ------------------------------------------------------------

-- Base on which a withholding percentage is applied.
create type public.withholding_base as enum ('net_ht', 'total_ttc');

create type public.brand_asset_kind as enum ('letterhead', 'stamp', 'logo', 'signature');

create type public.email_status as enum ('queued', 'sent', 'delivered', 'bounced', 'failed');

create type public.submission_status as enum (
  'pending',
  'submitted',
  'accepted',
  'rejected',
  'failed'
);

create type public.recurrence_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
