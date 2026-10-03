-- =============================================================================
-- 00002_core_tables.sql
-- Tenancy, settings, branding, identity.
-- The system is single-company today (Promptstack) but every business table carries
-- organization_id so multi-company is a configuration change, not a migration.
-- =============================================================================

-- Shared trigger: keep updated_at fresh -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- organizations -------------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  legal_name        text not null check (length(btrim(legal_name)) > 0),
  trade_name        text,
  -- Legal identifiers: intentionally nullable. An admin fills these in; they are never invented.
  niu               text,   -- Numero d'Identifiant Unique (tax payer number)
  rccm              text,   -- Registre du Commerce et du Credit Mobilier
  address_line1     text,
  address_line2     text,
  city              text,
  region            text,
  country           text not null default 'Cameroon',
  phone             text,
  email             text,
  website           text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- organization_settings -------------------------------------------------------------------
create table public.organization_settings (
  organization_id            uuid primary key references public.organizations(id) on delete cascade,
  default_currency           public.currency_code not null default 'XAF',
  timezone                   text not null default 'Africa/Douala',
  locale                     text not null default 'en',
  vat_registered             boolean not null default true,
  default_tax_rate_id        uuid,  -- FK added in 00003 once tax_rates exists
  default_payment_terms_days integer not null default 30 check (default_payment_terms_days between 0 and 365),
  proforma_validity_days     integer not null default 30 check (proforma_validity_days between 1 and 365),
  default_invoice_notes      text,
  default_invoice_terms      text,
  default_proforma_notes     text,
  default_proforma_terms     text,
  show_amount_in_words       boolean not null default true,
  stamp_enabled              boolean not null default true,
  -- Payment details printed on documents. All optional - filled by the admin.
  bank_name                  text,
  bank_account_name          text,
  bank_account_number        text,
  bank_iban                  text,
  bank_swift                 text,
  mobile_money_number        text,
  enabled_payment_methods    public.payment_method[] not null
                               default array['cash','bank_transfer','mobile_money','cheque']::public.payment_method[],
  fiscal_year_start_month    smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create trigger trg_org_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- brand_assets -------------------------------------------------------------------------------
-- Pointers to files in PRIVATE storage (bucket `branding`). Never public: the letterhead and
-- stamp are only ever read server-side when rendering PDFs.
create table public.brand_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             public.brand_asset_kind not null,
  storage_bucket   text not null default 'branding',
  storage_path     text not null,
  file_name        text not null,
  mime_type        text not null,
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  sha256           text,
  version          integer not null default 1 check (version >= 1),
  is_active        boolean not null default true,
  uploaded_by      uuid,
  created_at       timestamptz not null default now(),
  unique (organization_id, kind, version)
);
-- only one active asset per kind
create unique index brand_assets_one_active_per_kind
  on public.brand_assets (organization_id, kind) where is_active;

-- profiles -----------------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete set null,
  full_name        text,
  email            text,
  phone            text,
  avatar_path      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_organization_idx on public.profiles (organization_id);
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- user_roles -----------------------------------------------------------------------------------
create table public.user_roles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  role             public.user_role not null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (user_id, organization_id)
);
create index user_roles_org_role_idx on public.user_roles (organization_id, role);

-- Create a profile row automatically for every new auth user. The profile has NO organization
-- and NO role until an admin grants one, so a self sign-up can access nothing.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
