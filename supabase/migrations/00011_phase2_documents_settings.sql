-- =============================================================================
-- 00011_phase2_documents_settings.sql
-- Phase 2: approval workflow metadata, stamp layout / signatory settings, payment destinations,
-- and an issue_document() that enforces approval + freezes payment destinations.
--
-- Approval is metadata on DRAFT documents (documents.approval_status) rather than a new enum value,
-- so the existing immutability guards (00007) keep working unchanged: a document is either a draft
-- (editable) or issued (frozen).
-- =============================================================================

-- organization_settings: branding / approval ---------------------------------------------------------
alter table public.organization_settings
  add column if not exists require_approval   boolean not null default false,
  add column if not exists signatory_name     text,
  add column if not exists signatory_position text,
  -- Stamp placement overrides in PDF points (origin bottom-left). NULL = renderer default.
  add column if not exists stamp_x            numeric(7,2) check (stamp_x is null or (stamp_x >= 0 and stamp_x <= 595)),
  add column if not exists stamp_y            numeric(7,2) check (stamp_y is null or (stamp_y >= 0 and stamp_y <= 842)),
  add column if not exists stamp_width        numeric(7,2) check (stamp_width is null or (stamp_width >= 40 and stamp_width <= 300));

-- documents: approval metadata -----------------------------------------------------------------------------
alter table public.documents
  add column if not exists approval_status       text not null default 'none'
    check (approval_status in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists approval_requested_by uuid,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_by           uuid,
  add column if not exists approved_at           timestamptz,
  add column if not exists approval_note         text;

-- payment_destinations: bank accounts / mobile money wallets printed on documents -----------------------
do $$ begin
  create type public.payment_destination_kind as enum ('bank', 'mobile_money');
exception when duplicate_object then null; end $$;

create table if not exists public.payment_destinations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  kind              public.payment_destination_kind not null,
  label             text not null check (length(btrim(label)) > 0),
  provider          text,               -- bank name or operator (e.g. MTN MoMo, Orange Money)
  account_name      text,
  account_number    text,               -- account number or wallet number
  iban              text,
  swift             text,
  is_default        boolean not null default false,
  is_active         boolean not null default true,
  show_on_documents boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payment_destinations_org_idx on public.payment_destinations (organization_id);
create trigger trg_payment_destinations_updated_at before update on public.payment_destinations
  for each row execute function public.set_updated_at();

alter table public.payment_destinations enable row level security;
revoke all on public.payment_destinations from anon;
create policy payment_destinations_select on public.payment_destinations
  for select to authenticated using (public.is_org_member(organization_id));
create policy payment_destinations_insert on public.payment_destinations
  for insert to authenticated with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy payment_destinations_update on public.payment_destinations
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy payment_destinations_delete on public.payment_destinations
  for delete to authenticated using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- issue_document(): same contract as 00007 + approval gate + payment destinations in the issuer snapshot
create or replace function public.issue_document(p_document_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d           public.documents%rowtype;
  v_org       public.organizations%rowtype;
  v_settings  public.organization_settings%rowtype;
  v_customer  public.customers%rowtype;
  v_lines     integer;
  v_lines_ttc numeric;
  v_lines_ht  numeric;
  v_wht       numeric;
  v_terms     integer;
  v_number    text;
  v_dest      jsonb;
begin
  select * into d from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'Document % not found', p_document_id using errcode = 'P0002';
  end if;

  if (select auth.uid()) is not null
     and not public.has_org_role(d.organization_id, array['admin','accountant','sales']::public.user_role[]) then
    raise exception 'Not allowed to issue documents' using errcode = '42501';
  end if;

  if d.status <> 'draft' then
    raise exception 'Only draft documents can be issued (current status: %)', d.status using errcode = '55000';
  end if;

  select * into v_settings from public.organization_settings where organization_id = d.organization_id;
  if coalesce(v_settings.require_approval, false) and d.approval_status <> 'approved' then
    raise exception 'This document must be approved before it can be issued' using errcode = '55000';
  end if;

  select count(*), coalesce(sum(total_amount), 0), coalesce(sum(taxable_amount), 0)
    into v_lines, v_lines_ttc, v_lines_ht
    from public.document_items where document_id = d.id;
  if v_lines = 0 then
    raise exception 'A document needs at least one line before it can be issued' using errcode = '23514';
  end if;
  if v_lines_ttc <> d.total_ttc or v_lines_ht <> d.net_ht then
    raise exception 'Document totals are out of sync with its lines (recalculate and save first)' using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_wht from public.document_withholdings where document_id = d.id;
  if v_wht <> d.withholding_total then
    raise exception 'Withholding total is out of sync with its lines' using errcode = '23514';
  end if;

  select * into v_org from public.organizations where id = d.organization_id;
  select * into v_customer from public.customers where id = d.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', pd.kind, 'label', pd.label, 'provider', pd.provider,
           'account_name', pd.account_name, 'account_number', pd.account_number,
           'iban', pd.iban, 'swift', pd.swift
         ) order by pd.is_default desc, pd.sort_order, pd.created_at), '[]'::jsonb)
    into v_dest
    from public.payment_destinations pd
   where pd.organization_id = d.organization_id and pd.is_active and pd.show_on_documents;

  v_terms := coalesce(v_customer.payment_terms_days, v_settings.default_payment_terms_days, 30);
  v_number := public.allocate_document_number(d.organization_id, d.document_type, extract(year from d.issue_date)::integer);

  update public.documents
     set number = v_number,
         status = 'issued',
         issued_at = now(),
         issued_by = (select auth.uid()),
         due_date = case
                      when d.document_type = 'invoice' then coalesce(d.due_date, d.issue_date + v_terms)
                      else d.due_date
                    end,
         valid_until = case
                         when d.document_type = 'proforma'
                           then coalesce(d.valid_until, d.issue_date + coalesce(v_settings.proforma_validity_days, 30))
                         else d.valid_until
                       end,
         balance_due = case when d.document_type = 'invoice' then d.net_payable else 0 end,
         customer_snapshot = jsonb_build_object(
           'id', v_customer.id, 'name', v_customer.name, 'customer_type', v_customer.customer_type,
           'contact_name', v_customer.contact_name, 'email', v_customer.email, 'phone', v_customer.phone,
           'address_line1', v_customer.address_line1, 'address_line2', v_customer.address_line2,
           'city', v_customer.city, 'region', v_customer.region, 'country', v_customer.country,
           'niu', v_customer.niu, 'rccm', v_customer.rccm
         ),
         issuer_snapshot = jsonb_build_object(
           'id', v_org.id, 'legal_name', v_org.legal_name, 'trade_name', v_org.trade_name,
           'niu', v_org.niu, 'rccm', v_org.rccm,
           'address_line1', v_org.address_line1, 'address_line2', v_org.address_line2,
           'city', v_org.city, 'region', v_org.region, 'country', v_org.country,
           'phone', v_org.phone, 'email', v_org.email, 'website', v_org.website,
           'bank_name', v_settings.bank_name, 'bank_account_name', v_settings.bank_account_name,
           'bank_account_number', v_settings.bank_account_number, 'bank_iban', v_settings.bank_iban,
           'bank_swift', v_settings.bank_swift, 'mobile_money_number', v_settings.mobile_money_number,
           'payment_destinations', v_dest,
           'signatory_name', v_settings.signatory_name, 'signatory_position', v_settings.signatory_position
         )
   where id = d.id
   returning * into d;

  return d;
end;
$$;

revoke all on function public.issue_document(uuid) from public, anon;
grant execute on function public.issue_document(uuid) to authenticated, service_role;
