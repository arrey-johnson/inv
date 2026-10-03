-- =============================================================================
-- 00007_functions.sql
-- Authorization helpers, concurrency-safe numbering, issue workflow, immutability guards.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so they can read user_roles without RLS recursion)
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid())
      and ur.organization_id = p_org
      and p.is_active
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid())
      and ur.organization_id = p_org
      and ur.role = any (p_roles)
      and p.is_active
  );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ur.organization_id
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = (select auth.uid()) and p.is_active
  order by (ur.organization_id = p.organization_id) desc, ur.created_at asc
  limit 1;
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.user_role[]) from public, anon;
revoke all on function public.current_org_id() from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.user_role[]) to authenticated, service_role;
grant execute on function public.current_org_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- allocate_document_number(org_id, doc_type, issue_year)
--
-- Concurrency safety: a single INSERT ... ON CONFLICT DO UPDATE statement increments the counter
-- row. Postgres takes a row lock for the conflicting update, so two concurrent sessions are
-- serialized and can never receive the same number. Because the increment lives in the caller's
-- transaction, a rolled-back issue does not burn a number (gapless numbering).
--
-- Result example: PS-INV-2026-0001
-- ---------------------------------------------------------------------------------------------
create or replace function public.allocate_document_number(
  p_org_id      uuid,
  p_doc_type    public.document_type,
  p_issue_year  integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.document_sequences%rowtype;
  v_year   integer;
  v_next   integer;
  v_digits text;
begin
  if p_issue_year is null or p_issue_year < 2000 or p_issue_year > 2999 then
    raise exception 'Invalid issue year: %', p_issue_year using errcode = '22023';
  end if;

  -- Authenticated users must be allowed to issue documents; service role / internal calls pass.
  if (select auth.uid()) is not null
     and not public.has_org_role(p_org_id, array['admin','accountant','sales']::public.user_role[]) then
    raise exception 'Not allowed to allocate document numbers' using errcode = '42501';
  end if;

  select * into cfg
  from public.document_sequences
  where organization_id = p_org_id and document_type = p_doc_type and is_active;

  if not found then
    raise exception 'No active numbering sequence configured for % in organization %', p_doc_type, p_org_id
      using errcode = 'P0002';
  end if;

  v_year := case when cfg.reset_yearly then p_issue_year else 0 end;

  insert into public.document_sequence_counters as c (organization_id, document_type, sequence_year, last_number)
  values (p_org_id, p_doc_type, v_year, greatest(cfg.start_number, 1))
  on conflict (organization_id, document_type, sequence_year)
  do update set last_number = c.last_number + 1, updated_at = now()
  returning c.last_number into v_next;

  v_digits := v_next::text;
  if length(v_digits) < cfg.padding then
    v_digits := lpad(v_digits, cfg.padding, '0');
  end if;

  return cfg.prefix
      || case when cfg.include_year then cfg.separator || p_issue_year::text else '' end
      || cfg.separator
      || v_digits;
end;
$$;

revoke all on function public.allocate_document_number(uuid, public.document_type, integer) from public, anon;
grant execute on function public.allocate_document_number(uuid, public.document_type, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- issue_document(document_id): draft -> issued, atomically.
--   * validates stored totals against the lines
--   * freezes customer + issuer snapshots
--   * allocates the official number
--   * sets default due date / validity
-- ---------------------------------------------------------------------------------------------
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
  select * into v_settings from public.organization_settings where organization_id = d.organization_id;
  select * into v_customer from public.customers where id = d.customer_id;

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
           'bank_swift', v_settings.bank_swift, 'mobile_money_number', v_settings.mobile_money_number
         )
   where id = d.id
   returning * into d;

  return d;
end;
$$;

revoke all on function public.issue_document(uuid) from public, anon;
grant execute on function public.issue_document(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------------------------

-- Issued documents are legal records: identity and money columns are frozen; only workflow and
-- settlement columns may change. Voiding is the only way to "undo" an issued document.
create or replace function public.guard_document_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Issued documents cannot be deleted - void them instead' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    return new;
  end if;

  if old.status = 'void' then
    raise exception 'Voided documents are read-only' using errcode = '55000';
  end if;

  if new.status = 'draft' then
    raise exception 'An issued document cannot return to draft' using errcode = '55000';
  end if;

  if (old.organization_id, old.document_type, old.number, old.customer_id, old.customer_snapshot,
      old.issuer_snapshot, old.issue_date, old.currency, old.global_discount_type, old.global_discount_value,
      old.subtotal, old.line_discount_total, old.global_discount_amount, old.net_ht, old.tax_total,
      old.total_ttc, old.withholding_total, old.net_payable, old.issued_at, old.issued_by)
     is distinct from
     (new.organization_id, new.document_type, new.number, new.customer_id, new.customer_snapshot,
      new.issuer_snapshot, new.issue_date, new.currency, new.global_discount_type, new.global_discount_value,
      new.subtotal, new.line_discount_total, new.global_discount_amount, new.net_ht, new.tax_total,
      new.total_ttc, new.withholding_total, new.net_payable, new.issued_at, new.issued_by)
  then
    raise exception 'Issued documents are immutable (number %). Create a credit note or void instead.', old.number
      using errcode = '55000';
  end if;

  -- Voiding is a finance action.
  if new.status = 'void' and old.status <> 'void'
     and (select auth.uid()) is not null
     and not public.has_org_role(old.organization_id, array['admin','accountant']::public.user_role[]) then
    raise exception 'Only admins and accountants can void documents' using errcode = '42501';
  end if;

  if new.status = 'void' and old.status <> 'void'
     and (old.paid_amount > 0 or old.credited_amount > 0 or old.advance_applied_amount > 0) then
    raise exception 'Cannot void a document that has payments, credits or advances applied' using errcode = '55000';
  end if;

  return new;
end;
$$;
create trigger trg_guard_document_mutation
  before update or delete on public.documents
  for each row execute function public.guard_document_mutation();

-- Lines / withholdings can only change while the parent document is a draft.
create or replace function public.guard_document_children()
returns trigger
language plpgsql
as $$
declare
  v_document_id uuid;
  v_status      public.document_status;
  v_org         uuid;
begin
  v_document_id := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  select status into v_status from public.documents where id = v_document_id;
  select organization_id into v_org from public.documents where id = v_document_id;

  -- Parent already gone (cascade delete of a draft): allow.
  if v_status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_status <> 'draft' then
    raise exception 'Cannot modify lines of a % document', v_status using errcode = '55000';
  end if;

  if tg_op <> 'DELETE' and new.organization_id <> v_org then
    raise exception 'Line organization does not match the document organization' using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger trg_guard_document_items
  before insert or update or delete on public.document_items
  for each row execute function public.guard_document_children();
create trigger trg_guard_document_withholdings
  before insert or update or delete on public.document_withholdings
  for each row execute function public.guard_document_children();

-- ---------------------------------------------------------------------------------------------
-- Identity guards
-- ---------------------------------------------------------------------------------------------

-- A user may edit their own profile but never promote themselves / re-activate themselves.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (select auth.uid()) = old.id
     and not coalesce(public.has_org_role(old.organization_id, array['admin']::public.user_role[]), false) then
    new.organization_id := old.organization_id;
    new.is_active := old.is_active;
    new.email := old.email;
  end if;
  return new;
end;
$$;
create trigger trg_guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- An organization must always keep at least one admin.
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.organization_id <> old.organization_id)
     and exists (select 1 from public.organizations where id = old.organization_id)   -- not an org cascade delete
     and not exists (
       select 1 from public.user_roles
       where organization_id = old.organization_id and role = 'admin' and user_id <> old.user_id
     )
  then
    raise exception 'An organization must keep at least one admin' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger trg_guard_last_admin
  before update or delete on public.user_roles
  for each row execute function public.guard_last_admin();
