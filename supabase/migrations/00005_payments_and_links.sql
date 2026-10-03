-- =============================================================================
-- 00005_payments_and_links.sql
-- Payments, allocations, credit-note / advance application, generic document links.
-- =============================================================================

-- payments: money received from a customer -----------------------------------------------------
create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  customer_id           uuid not null references public.customers(id) on delete restrict,
  payment_date          date not null default current_date,
  amount                numeric(18,2) not null check (amount > 0),
  currency              public.currency_code not null default 'XAF',
  method                public.payment_method not null,
  reference             text,                         -- bank ref, mobile money transaction id, cheque no.
  notes                 text,
  -- Receipt (RCP) or advance (ADV) document generated for this payment, if any
  receipt_document_id   uuid references public.documents(id) on delete set null,
  received_by           uuid,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint payments_void_has_reason check (voided_at is null or void_reason is not null)
);
create index payments_org_date_idx on public.payments (organization_id, payment_date desc);
create index payments_org_customer_idx on public.payments (organization_id, customer_id);
create index payments_receipt_doc_idx on public.payments (receipt_document_id) where receipt_document_id is not null;
create index payments_org_method_idx on public.payments (organization_id, method);
create trigger trg_payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- payment_allocations: split a payment across invoices ----------------------------------------------
create table public.payment_allocations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  payment_id       uuid not null references public.payments(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete restrict,   -- an invoice
  amount           numeric(18,2) not null check (amount > 0),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (payment_id, document_id)
);
create index payment_allocations_document_idx on public.payment_allocations (document_id);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_org_idx on public.payment_allocations (organization_id);

-- credit_note_links: a credit note applied against an invoice ------------------------------------------
create table public.credit_note_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  credit_note_id    uuid not null references public.documents(id) on delete restrict,
  invoice_id        uuid not null references public.documents(id) on delete restrict,
  amount            numeric(18,2) not null check (amount > 0),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (credit_note_id, invoice_id),
  check (credit_note_id <> invoice_id)
);
create index credit_note_links_invoice_idx on public.credit_note_links (invoice_id);
create index credit_note_links_credit_note_idx on public.credit_note_links (credit_note_id);
create index credit_note_links_org_idx on public.credit_note_links (organization_id);

-- advance_links: an advance (deposit) applied against an invoice -----------------------------------------
create table public.advance_links (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  advance_document_id  uuid not null references public.documents(id) on delete restrict,
  invoice_id           uuid not null references public.documents(id) on delete restrict,
  amount               numeric(18,2) not null check (amount > 0),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  unique (advance_document_id, invoice_id),
  check (advance_document_id <> invoice_id)
);
create index advance_links_invoice_idx on public.advance_links (invoice_id);
create index advance_links_advance_idx on public.advance_links (advance_document_id);
create index advance_links_org_idx on public.advance_links (organization_id);

-- document_links: generic relation graph (proforma -> invoice, revision_of, ...) ---------------------------
create table public.document_links (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  source_document_id   uuid not null references public.documents(id) on delete cascade,
  target_document_id   uuid not null references public.documents(id) on delete cascade,
  link_type            text not null check (link_type in (
                         'converted_to', 'credit_for', 'advance_for', 'receipt_for', 'revision_of', 'duplicate_of'
                       )),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  unique (source_document_id, target_document_id, link_type),
  check (source_document_id <> target_document_id)
);
create index document_links_source_idx on public.document_links (source_document_id);
create index document_links_target_idx on public.document_links (target_document_id);
create index document_links_org_idx on public.document_links (organization_id);

-- ---------------------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------------------

-- Allocation: invoice only, same org / customer / currency, not exceeding payment or invoice balance.
create or replace function public.validate_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
  v_doc documents%rowtype;
  v_allocated numeric;
begin
  select * into v_payment from payments where id = new.payment_id for update;
  select * into v_doc from documents where id = new.document_id for update;

  if v_payment.id is null or v_doc.id is null then
    raise exception 'Payment or document not found';
  end if;
  if v_payment.voided_at is not null then
    raise exception 'Cannot allocate a voided payment';
  end if;
  if v_doc.document_type <> 'invoice' then
    raise exception 'Payments can only be allocated to invoices (got %)', v_doc.document_type;
  end if;
  if v_doc.status in ('draft', 'void') then
    raise exception 'Cannot allocate to a % invoice', v_doc.status;
  end if;
  if v_payment.organization_id <> new.organization_id or v_doc.organization_id <> new.organization_id then
    raise exception 'Organization mismatch in payment allocation';
  end if;
  if v_payment.customer_id <> v_doc.customer_id then
    raise exception 'Payment and invoice belong to different customers';
  end if;
  if v_payment.currency <> v_doc.currency then
    raise exception 'Payment and invoice currencies differ';
  end if;

  select coalesce(sum(amount), 0) into v_allocated
  from payment_allocations
  where payment_id = new.payment_id and id <> new.id;
  if v_allocated + new.amount > v_payment.amount then
    raise exception 'Allocations (%) exceed the payment amount (%)', v_allocated + new.amount, v_payment.amount;
  end if;

  select coalesce(sum(amount), 0) into v_allocated
  from (
    select pa.amount from payment_allocations pa join payments pp on pp.id = pa.payment_id
      where pa.document_id = new.document_id and pa.id <> new.id and pp.voided_at is null
    union all select amount from credit_note_links where invoice_id = new.document_id
    union all select amount from advance_links where invoice_id = new.document_id
  ) s;
  if v_allocated + new.amount > v_doc.net_payable then
    raise exception 'Settlement (%) would exceed the invoice amount due (%)', v_allocated + new.amount, v_doc.net_payable;
  end if;
  return new;
end;
$$;
create trigger trg_validate_payment_allocation
  before insert or update on public.payment_allocations
  for each row execute function public.validate_payment_allocation();

-- Credit note link: credit_note doc -> invoice doc, within credit note total and invoice total_ttc.
create or replace function public.validate_credit_note_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cn documents%rowtype;
  v_inv documents%rowtype;
  v_used_cn numeric;
  v_used_inv numeric;
begin
  select * into v_cn from documents where id = new.credit_note_id for update;
  select * into v_inv from documents where id = new.invoice_id for update;
  if v_cn.id is null or v_inv.id is null then raise exception 'Document not found'; end if;
  if v_cn.document_type <> 'credit_note' then raise exception 'credit_note_id must reference a credit note'; end if;
  if v_inv.document_type <> 'invoice' then raise exception 'invoice_id must reference an invoice'; end if;
  if v_cn.status in ('draft', 'void') or v_inv.status in ('draft', 'void') then
    raise exception 'Both documents must be issued and not void';
  end if;
  if v_cn.organization_id <> new.organization_id or v_inv.organization_id <> new.organization_id then
    raise exception 'Organization mismatch in credit note link';
  end if;
  if v_cn.customer_id <> v_inv.customer_id then raise exception 'Credit note and invoice belong to different customers'; end if;
  if v_cn.currency <> v_inv.currency then raise exception 'Credit note and invoice currencies differ'; end if;

  select coalesce(sum(amount), 0) into v_used_cn from credit_note_links where credit_note_id = new.credit_note_id and id <> new.id;
  if v_used_cn + new.amount > v_cn.total_ttc then
    raise exception 'Credit note applications (%) exceed its total (%)', v_used_cn + new.amount, v_cn.total_ttc;
  end if;

  select coalesce(sum(amount), 0) into v_used_inv from credit_note_links where invoice_id = new.invoice_id and id <> new.id;
  if v_used_inv + new.amount > v_inv.total_ttc then
    raise exception 'Credits (%) would exceed the invoice total (%)', v_used_inv + new.amount, v_inv.total_ttc;
  end if;
  return new;
end;
$$;
create trigger trg_validate_credit_note_link
  before insert or update on public.credit_note_links
  for each row execute function public.validate_credit_note_link();

-- Advance link: advance doc -> invoice doc, within advance total and invoice balance.
create or replace function public.validate_advance_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adv documents%rowtype;
  v_inv documents%rowtype;
  v_used_adv numeric;
  v_settled numeric;
begin
  select * into v_adv from documents where id = new.advance_document_id for update;
  select * into v_inv from documents where id = new.invoice_id for update;
  if v_adv.id is null or v_inv.id is null then raise exception 'Document not found'; end if;
  if v_adv.document_type <> 'advance' then raise exception 'advance_document_id must reference an advance'; end if;
  if v_inv.document_type <> 'invoice' then raise exception 'invoice_id must reference an invoice'; end if;
  if v_adv.status in ('draft', 'void') or v_inv.status in ('draft', 'void') then
    raise exception 'Both documents must be issued and not void';
  end if;
  if v_adv.organization_id <> new.organization_id or v_inv.organization_id <> new.organization_id then
    raise exception 'Organization mismatch in advance link';
  end if;
  if v_adv.customer_id <> v_inv.customer_id then raise exception 'Advance and invoice belong to different customers'; end if;
  if v_adv.currency <> v_inv.currency then raise exception 'Advance and invoice currencies differ'; end if;

  select coalesce(sum(amount), 0) into v_used_adv from advance_links where advance_document_id = new.advance_document_id and id <> new.id;
  if v_used_adv + new.amount > v_adv.total_ttc then
    raise exception 'Advance applications (%) exceed the advance amount (%)', v_used_adv + new.amount, v_adv.total_ttc;
  end if;

  select coalesce(sum(amount), 0) into v_settled
  from (
    select pa.amount from payment_allocations pa join payments pp on pp.id = pa.payment_id
      where pa.document_id = new.invoice_id and pp.voided_at is null
    union all select amount from credit_note_links where invoice_id = new.invoice_id
    union all select amount from advance_links where invoice_id = new.invoice_id and id <> new.id
  ) s;
  if v_settled + new.amount > v_inv.net_payable then
    raise exception 'Settlement (%) would exceed the invoice amount due (%)', v_settled + new.amount, v_inv.net_payable;
  end if;
  return new;
end;
$$;
create trigger trg_validate_advance_link
  before insert or update on public.advance_links
  for each row execute function public.validate_advance_link();

-- Keep documents.* settlement columns and status in sync with allocations / links -----------------------
create or replace function public.recompute_document_settlement(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents%rowtype;
  v_paid numeric;
  v_credit numeric;
  v_adv numeric;
  v_settled numeric;
  v_balance numeric;
  v_status public.document_status;
begin
  select * into d from documents where id = p_document_id for update;
  if not found or d.document_type <> 'invoice' or d.status in ('draft', 'void') then
    return;
  end if;

  select coalesce(sum(a.amount), 0) into v_paid
    from payment_allocations a join payments p on p.id = a.payment_id
    where a.document_id = p_document_id and p.voided_at is null;
  select coalesce(sum(amount), 0) into v_credit from credit_note_links where invoice_id = p_document_id;
  select coalesce(sum(amount), 0) into v_adv from advance_links where invoice_id = p_document_id;

  v_settled := v_paid + v_credit + v_adv;
  v_balance := greatest(d.net_payable - v_settled, 0);
  v_status := d.status;

  if v_balance = 0 and (v_settled > 0 or d.net_payable = 0) then
    v_status := 'paid';
  elsif v_settled > 0 then
    v_status := 'partially_paid';
  elsif d.due_date is not null and d.due_date < current_date then
    v_status := 'overdue';
  elsif d.status in ('partially_paid', 'paid', 'overdue') then
    v_status := case when d.sent_at is not null then 'sent' else 'issued' end;
  end if;

  update documents
     set paid_amount = v_paid,
         credited_amount = v_credit,
         advance_applied_amount = v_adv,
         balance_due = v_balance,
         status = v_status
   where id = p_document_id;
end;
$$;

create or replace function public.trg_recompute_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_table_name = 'payment_allocations' then
    v_old := case when tg_op in ('UPDATE', 'DELETE') then old.document_id end;
    v_new := case when tg_op in ('INSERT', 'UPDATE') then new.document_id end;
  else
    v_old := case when tg_op in ('UPDATE', 'DELETE') then old.invoice_id end;
    v_new := case when tg_op in ('INSERT', 'UPDATE') then new.invoice_id end;
  end if;
  if v_old is not null then perform public.recompute_document_settlement(v_old); end if;
  if v_new is not null and v_new is distinct from v_old then perform public.recompute_document_settlement(v_new); end if;
  return null;
end;
$$;

create trigger trg_payment_allocations_settlement
  after insert or update or delete on public.payment_allocations
  for each row execute function public.trg_recompute_settlement();
create trigger trg_credit_note_links_settlement
  after insert or update or delete on public.credit_note_links
  for each row execute function public.trg_recompute_settlement();
create trigger trg_advance_links_settlement
  after insert or update or delete on public.advance_links
  for each row execute function public.trg_recompute_settlement();

-- When a payment is voided, refresh every invoice it touched.
create or replace function public.trg_payment_void_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if (old.voided_at is null) is distinct from (new.voided_at is null) then
    for r in select document_id from payment_allocations where payment_id = new.id loop
      perform public.recompute_document_settlement(r.document_id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger trg_payments_void_recompute
  after update of voided_at on public.payments
  for each row execute function public.trg_payment_void_recompute();
