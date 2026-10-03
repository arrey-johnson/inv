-- =============================================================================
-- 00003_catalog_tables.sql
-- Customers, items, tax rates, withholding types.
-- =============================================================================

-- tax_rates ------------------------------------------------------------------------------------
create table public.tax_rates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null,
  name             text not null,
  rate             numeric(7,4) not null check (rate >= 0 and rate <= 100),   -- percent, e.g. 19.2500
  category         public.tax_category not null default 'standard',
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);
create unique index tax_rates_one_default_per_org on public.tax_rates (organization_id) where is_default;
create trigger trg_tax_rates_updated_at before update on public.tax_rates
  for each row execute function public.set_updated_at();

alter table public.organization_settings
  add constraint organization_settings_default_tax_rate_fk
  foreign key (default_tax_rate_id) references public.tax_rates(id) on delete set null;

-- withholding_types -------------------------------------------------------------------------------
-- Rates are configured by the admin (no rate is assumed here).
create table public.withholding_types (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null,
  name             text not null,
  rate             numeric(7,4) not null check (rate >= 0 and rate <= 100),
  base             public.withholding_base not null default 'net_ht',
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);
create trigger trg_withholding_types_updated_at before update on public.withholding_types
  for each row execute function public.set_updated_at();

-- customers -----------------------------------------------------------------------------------------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  customer_type       public.customer_type not null default 'company',
  code                text,                              -- optional human code, unique per org
  name                text not null check (length(btrim(name)) > 0),
  contact_name        text,
  email               text,
  phone               text,
  address_line1       text,
  address_line2       text,
  city                text,
  region              text,
  country             text not null default 'Cameroon',
  niu                 text,
  rccm                text,
  default_currency    public.currency_code not null default 'XAF',
  payment_terms_days  integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  default_withholding_type_id uuid references public.withholding_types(id) on delete set null,
  notes               text,
  is_active           boolean not null default true,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create unique index customers_org_code_uidx on public.customers (organization_id, lower(code)) where code is not null and deleted_at is null;
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_name_trgm_idx on public.customers using gin (name gin_trgm_ops);
create index customers_org_active_idx on public.customers (organization_id) where deleted_at is null and is_active;
create trigger trg_customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- items --------------------------------------------------------------------------------------------------
create table public.items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  item_type        public.item_type not null default 'service',
  sku              text,
  name             text not null check (length(btrim(name)) > 0),
  description      text,
  unit             text,                                     -- e.g. "hour", "pcs", "month"
  unit_price       numeric(18,4) not null default 0 check (unit_price >= 0),
  currency         public.currency_code not null default 'XAF',
  tax_rate_id      uuid references public.tax_rates(id) on delete set null,
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create unique index items_org_sku_uidx on public.items (organization_id, lower(sku)) where sku is not null and deleted_at is null;
create index items_org_name_idx on public.items (organization_id, lower(name));
create index items_name_trgm_idx on public.items using gin (name gin_trgm_ops);
create trigger trg_items_updated_at before update on public.items
  for each row execute function public.set_updated_at();
