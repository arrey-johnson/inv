-- =============================================================================
-- 00012_phase3_5_finance.sql
-- Payments, overdue, credit notes, advance invoices, void/cancel.
--
-- !! NOT YET RUN AGAINST A REAL POSTGRES / SUPABASE INSTANCE !!
-- The demo adapter (src/lib/data/demo) is the verified reference implementation and the vitest suite
-- covers the business rules. This file mirrors those rules in SQL (src/lib/payments/settlement.ts).
-- Apply it to a throw-away Supabase project first and run the same scenarios before using it for real data.
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used inside the same transaction that uses the new value.
-- Nothing in this file references the new enum values at parse time (only inside function bodies).
-- =============================================================================

-- 1. Enum additions ------------------------------------------------------------------------------------
alter type public.payment_method add value if not exists 'mtn_momo';
alter type public.payment_method add value if not exists 'orange_money';
alter type public.document_status add value if not exists 'credited';

-- 2. Column additions ----------------------------------------------------------------------------------
alter table public.payments
  add column if not exists is_adjustment boolean not null default false,
  add column if not exists adjustment_reason text;
alter table public.payments
  drop constraint if exists payments_adjustment_has_reason;
alter table public.payments
  add constraint payments_adjustment_has_reason
  check (not is_adjustment or (adjustment_reason is not null and length(btrim(adjustment_reason)) >= 5));

-- Split of an advance deduction between HT and VAT, so VAT is never declared twice.
alter table public.advance_links
  add column if not exists ht_amount  numeric(18,2) not null default 0 check (ht_amount >= 0),
  add column if not exists vat_amount numeric(18,2) not null default 0 check (vat_amount >= 0);
update public.advance_links set ht_amount = amount where ht_amount = 0 and vat_amount = 0;
alter table public.advance_links drop constraint if exists advance_links_split_matches;
alter table public.advance_links
  add constraint advance_links_split_matches check (ht_amount + vat_amount = amount);

-- Credit-note lines may reference the invoice line they credit.
alter table public.document_items
  add column if not exists credit_source_item_id uuid references public.document_items(id) on delete set null;

-- 3. Helpers -------------------------------------------------------------------------------------------
create or replace function public.currency_decimals(p_currency public.currency_code)
returns integer
language sql
immutable
as $$ select case p_currency::text when 'XAF' then 0 else 2 end; $$;

-- Cash effect of credit notes on an invoice. Credits are expressed in TTC; a withholding reduces net payable,
-- so the credit effect is proportional to net_payable / total_ttc.
create or replace function public.credit_effect(
  p_credit_ttc numeric, p_total_ttc numeric, p_net_payable numeric, p_currency public.currency_code
) returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_credit_ttc, 0) <= 0 or p_total_ttc <= 0 then 0
    when p_net_payable = p_total_ttc then round(p_credit_ttc, public.currency_decimals(p_currency))
    else round(p_credit_ttc * p_net_payable / p_total_ttc, public.currency_decimals(p_currency))
  end;
$$;

-- 4. Integrity triggers (replace) ----------------------------------------------------------------------
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
  v_paid_other numeric;
  v_credits numeric;
  v_adv numeric;
  v_settled numeric;
begin
  select * into v_payment from payments where id = new.payment_id for update;
  select * into v_doc from documents where id = new.document_id for update;

  if v_payment.id is null or v_doc.id is null then
    raise exception 'Payment or document not found';
  end if;
  if v_payment.voided_at is not null then
    raise exception 'Cannot allocate a voided payment';
  end if;
  if v_doc.document_type not in ('invoice', 'advance') then
    raise exception 'Payments can only be allocated to invoices or advance invoices (got %)', v_doc.document_type;
  end if;
  if v_doc.status not in ('issued', 'sent', 'partially_paid', 'overdue') then
    raise exception 'Cannot allocate a payment to a % document', v_doc.status;
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

  select coalesce(sum(pa.amount), 0) into v_paid_other
    from payment_allocations pa join payments pp on pp.id = pa.payment_id
   where pa.document_id = new.document_id and pa.id <> new.id and pp.voided_at is null;
  select coalesce(sum(amount), 0) into v_credits from credit_note_links where invoice_id = new.document_id;
  select coalesce(sum(amount), 0) into v_adv from advance_links where invoice_id = new.document_id;
  v_settled := v_paid_other
             + public.credit_effect(v_credits, v_doc.total_ttc, v_doc.net_payable, v_doc.currency)
             + v_adv;
  if v_settled + new.amount > v_doc.net_payable then
    raise exception 'Overpayment refused: % is more than the balance due on % (%)',
      new.amount, coalesce(v_doc.number, 'this document'), greatest(v_doc.net_payable - v_settled, 0);
  end if;
  return new;
end;
$$;

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
  v_paid numeric;
  v_credits numeric;
  v_adv_other numeric;
  v_settled numeric;
begin
  select * into v_adv from documents where id = new.advance_document_id for update;
  select * into v_inv from documents where id = new.invoice_id for update;
  if v_adv.id is null or v_inv.id is null then raise exception 'Document not found'; end if;
  if v_adv.document_type <> 'advance' then raise exception 'advance_document_id must reference an advance'; end if;
  if v_inv.document_type <> 'invoice' then raise exception 'invoice_id must reference an invoice'; end if;
  if v_adv.status <> 'paid' then
    raise exception 'Only an advance whose payment has been received in full can be deducted';
  end if;
  if v_inv.status not in ('issued', 'sent', 'partially_paid', 'overdue') then
    raise exception 'Advances can only be deducted from an open invoice';
  end if;
  if v_adv.organization_id <> new.organization_id or v_inv.organization_id <> new.organization_id then
    raise exception 'Organization mismatch in advance link';
  end if;
  if v_adv.customer_id <> v_inv.customer_id then raise exception 'Advance and invoice belong to different customers'; end if;
  if v_adv.currency <> v_inv.currency then raise exception 'Advance and invoice currencies differ'; end if;

  select coalesce(sum(amount), 0) into v_used_adv
    from advance_links where advance_document_id = new.advance_document_id and id <> new.id;
  if v_used_adv + new.amount > v_adv.total_ttc then
    raise exception 'The amount is more than what remains of the advance (% of % already used)', v_used_adv, v_adv.total_ttc;
  end if;

  select coalesce(sum(pa.amount), 0) into v_paid
    from payment_allocations pa join payments pp on pp.id = pa.payment_id
   where pa.document_id = new.invoice_id and pp.voided_at is null;
  select coalesce(sum(amount), 0) into v_credits from credit_note_links where invoice_id = new.invoice_id;
  select coalesce(sum(amount), 0) into v_adv_other from advance_links where invoice_id = new.invoice_id and id <> new.id;
  v_settled := v_paid + public.credit_effect(v_credits, v_inv.total_ttc, v_inv.net_payable, v_inv.currency) + v_adv_other;
  if v_settled + new.amount > v_inv.net_payable then
    raise exception 'The amount is more than the balance due on the invoice (%)', greatest(v_inv.net_payable - v_settled, 0);
  end if;
  return new;
end;
$$;

-- 5. Settlement recomputation (replaces the 00005 version) ---------------------------------------------
drop function if exists public.recompute_document_settlement(uuid);

create or replace function public.recompute_document_settlement(p_document_id uuid, p_today date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents%rowtype;
  v_paid numeric;
  v_credit_ttc numeric;
  v_credit numeric;
  v_adv numeric;
  v_settled numeric;
  v_balance numeric;
  v_status public.document_status;
begin
  select * into d from documents where id = p_document_id for update;
  if not found or d.document_type not in ('invoice', 'advance') or d.status in ('draft', 'void') then
    return;
  end if;

  select coalesce(sum(a.amount), 0) into v_paid
    from payment_allocations a join payments p on p.id = a.payment_id
   where a.document_id = p_document_id and p.voided_at is null;
  select coalesce(sum(amount), 0) into v_credit_ttc from credit_note_links where invoice_id = p_document_id;
  select coalesce(sum(amount), 0) into v_adv from advance_links where invoice_id = p_document_id;

  v_credit := public.credit_effect(v_credit_ttc, d.total_ttc, d.net_payable, d.currency);
  v_settled := v_paid + v_credit + v_adv;
  v_balance := greatest(d.net_payable - v_settled, 0);

  if v_balance = 0 and (v_settled > 0 or d.net_payable = 0) then
    -- Fully credited with nothing paid or deducted -> 'credited'; anything else that clears the balance -> 'paid'.
    if v_credit_ttc > 0 and v_credit_ttc >= d.total_ttc and v_paid = 0 and v_adv = 0 then
      v_status := 'credited';
    else
      v_status := 'paid';
    end if;
  elsif d.due_date is not null and d.due_date < p_today then
    v_status := 'overdue';
  elsif v_paid > 0 or v_adv > 0 then
    v_status := 'partially_paid';
  else
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

revoke all on function public.recompute_document_settlement(uuid, date) from public, anon, authenticated;
grant execute on function public.recompute_document_settlement(uuid, date) to service_role;

-- 6. Document guard: cancelled documents stay read-only, except PDF + public-link bookkeeping -----------
create or replace function public.guard_document_mutation()
returns trigger
language plpgsql
as $$
declare
  v_volatile text[] := array[
    'pdf_storage_path', 'pdf_sha256', 'pdf_generated_at',
    'public_token_hash', 'public_token_created_at', 'public_token_expires_at', 'public_token_revoked_at',
    'updated_at', 'updated_by'
  ];
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
    if (to_jsonb(old) - v_volatile) is distinct from (to_jsonb(new) - v_volatile) then
      raise exception 'Voided documents are read-only' using errcode = '55000';
    end if;
    return new;
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

-- 7. RPCs used by the Supabase adapter -----------------------------------------------------------------
create or replace function public.record_payment(
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency public.currency_code,
  p_method public.payment_method,
  p_reference text,
  p_notes text,
  p_is_adjustment boolean,
  p_adjustment_reason text,
  p_allocations jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_alloc jsonb;
  v_sum numeric := 0;
  v_amt numeric;
begin
  select organization_id into v_org from customers where id = p_customer_id and deleted_at is null;
  if v_org is null then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;

  if (select auth.uid()) is not null
     and not public.has_org_role(v_org, array['admin','accountant']::public.user_role[]) then
    raise exception 'Not allowed to record payments' using errcode = '42501';
  end if;
  if coalesce(p_is_adjustment, false)
     and (select auth.uid()) is not null
     and not public.has_org_role(v_org, array['admin']::public.user_role[]) then
    raise exception 'Only an admin can record an adjustment' using errcode = '42501';
  end if;
  if coalesce(p_is_adjustment, false) and length(btrim(coalesce(p_adjustment_reason, ''))) < 5 then
    raise exception 'An adjustment needs a written reason' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The payment amount must be greater than zero' using errcode = '23514';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'The payment date cannot be in the future' using errcode = '23514';
  end if;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_sum := v_sum + (v_alloc->>'amount')::numeric;
  end loop;
  if v_sum > p_amount then
    raise exception 'Allocations (%) exceed the payment amount (%)', v_sum, p_amount using errcode = '23514';
  end if;

  insert into payments (organization_id, customer_id, payment_date, amount, currency, method, reference, notes,
                        is_adjustment, adjustment_reason, received_by, created_by)
  values (v_org, p_customer_id, p_payment_date, p_amount, p_currency, p_method, nullif(btrim(p_reference), ''),
          nullif(btrim(p_notes), ''), coalesce(p_is_adjustment, false),
          case when coalesce(p_is_adjustment, false) then btrim(p_adjustment_reason) end,
          (select auth.uid()), (select auth.uid()))
  returning id into v_id;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := (v_alloc->>'amount')::numeric;
    insert into payment_allocations (organization_id, payment_id, document_id, amount, created_by)
    values (v_org, v_id, (v_alloc->>'document_id')::uuid, v_amt, (select auth.uid()));
  end loop;

  return v_id;
end;
$$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p payments%rowtype;
begin
  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null
     and not public.has_org_role(p.organization_id, array['admin','accountant']::public.user_role[]) then
    raise exception 'Not allowed to void payments' using errcode = '42501';
  end if;
  if p.voided_at is not null then raise exception 'This payment is already voided' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required to void a payment' using errcode = '23514';
  end if;
  update payments
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = p_payment_id;   -- trg_payments_void_recompute refreshes every invoice it touched
end;
$$;

create or replace function public.apply_credit_note(p_credit_note_id uuid, p_invoice_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from documents where id = p_credit_note_id;
  if v_org is null then raise exception 'Credit note not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null
     and not public.has_org_role(v_org, array['admin','accountant']::public.user_role[]) then
    raise exception 'Not allowed to apply credit notes' using errcode = '42501';
  end if;
  insert into credit_note_links (organization_id, credit_note_id, invoice_id, amount, created_by)
  values (v_org, p_credit_note_id, p_invoice_id, p_amount, (select auth.uid()));
end;
$$;

create or replace function public.release_credit_note(p_credit_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from documents where id = p_credit_note_id;
  if v_org is null then raise exception 'Credit note not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null
     and not public.has_org_role(v_org, array['admin','accountant']::public.user_role[]) then
    raise exception 'Not allowed to release credit notes' using errcode = '42501';
  end if;
  delete from credit_note_links where credit_note_id = p_credit_note_id;  -- recompute trigger refreshes invoices
end;
$$;

create or replace function public.apply_advance(
  p_advance_id uuid, p_invoice_id uuid, p_amount numeric, p_ht_amount numeric, p_vat_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from documents where id = p_advance_id;
  if v_org is null then raise exception 'Advance not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null
     and not public.has_org_role(v_org, array['admin','accountant']::public.user_role[]) then
    raise exception 'Not allowed to apply advances' using errcode = '42501';
  end if;
  insert into advance_links (organization_id, advance_document_id, invoice_id, amount, ht_amount, vat_amount, created_by)
  values (v_org, p_advance_id, p_invoice_id, p_amount, p_ht_amount, p_vat_amount, (select auth.uid()));
end;
$$;

create or replace function public.void_document(p_document_id uuid, p_reason text)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.documents%rowtype;
begin
  select * into d from documents where id = p_document_id for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null
     and not public.has_org_role(d.organization_id, array['admin','accountant']::public.user_role[]) then
    raise exception 'Only admins and accountants can void documents' using errcode = '42501';
  end if;
  if d.status = 'draft' then raise exception 'A draft is deleted, not cancelled' using errcode = '55000'; end if;
  if d.status = 'void' then raise exception 'This document is already cancelled' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required to cancel a document' using errcode = '23514';
  end if;

  -- The number is kept; only status + void metadata change. The guard trigger refuses documents that have
  -- payments, credits or advances applied.
  update documents
     set status = 'void',
         voided_at = now(),
         voided_by = (select auth.uid()),
         void_reason = btrim(p_reason),
         balance_due = 0
   where id = p_document_id
   returning * into d;
  return d;
end;
$$;

-- Marks overdue (and un-marks documents whose due date moved) for the caller's organization.
create or replace function public.sync_overdue(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  r record;
  v_after public.document_status;
  v_changed integer := 0;
begin
  for r in
    select id, status from documents
     where deleted_at is null
       and document_type in ('invoice', 'advance')
       and status in ('issued', 'sent', 'partially_paid', 'overdue')
       and (v_org is null or organization_id = v_org)
  loop
    perform public.recompute_document_settlement(r.id, p_today);
    select status into v_after from documents where id = r.id;
    if v_after is distinct from r.status then v_changed := v_changed + 1; end if;
  end loop;
  return v_changed;
end;
$$;

revoke all on function public.record_payment(uuid, date, numeric, public.currency_code, public.payment_method, text, text, boolean, text, jsonb) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.apply_credit_note(uuid, uuid, numeric) from public, anon;
revoke all on function public.release_credit_note(uuid) from public, anon;
revoke all on function public.apply_advance(uuid, uuid, numeric, numeric, numeric) from public, anon;
revoke all on function public.void_document(uuid, text) from public, anon;
revoke all on function public.sync_overdue(date) from public, anon;
grant execute on function public.record_payment(uuid, date, numeric, public.currency_code, public.payment_method, text, text, boolean, text, jsonb) to authenticated, service_role;
grant execute on function public.void_payment(uuid, text) to authenticated, service_role;
grant execute on function public.apply_credit_note(uuid, uuid, numeric) to authenticated, service_role;
grant execute on function public.release_credit_note(uuid) to authenticated, service_role;
grant execute on function public.apply_advance(uuid, uuid, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.void_document(uuid, text) to authenticated, service_role;
grant execute on function public.sync_overdue(date) to authenticated, service_role;

-- 8. issue_document: advance invoices behave like invoices (due date + balance) -------------------------
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
                      when d.document_type in ('invoice', 'advance') then coalesce(d.due_date, d.issue_date + v_terms)
                      else d.due_date
                    end,
         valid_until = case
                         when d.document_type = 'proforma'
                           then coalesce(d.valid_until, d.issue_date + coalesce(v_settings.proforma_validity_days, 30))
                         else d.valid_until
                       end,
         balance_due = case when d.document_type in ('invoice', 'advance') then d.net_payable else 0 end,
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
