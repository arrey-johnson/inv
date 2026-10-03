-- Allow editing issued (non-void) documents while keeping the official number and issue stamp.
-- Lines and money totals may change; settlement is recomputed after the app saves.

-- 1. Document header: protect identity stamp, allow content amendments ---------------------------------
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

  -- Official number and issue stamp stay frozen forever.
  if (old.organization_id, old.document_type, old.number, old.issued_at, old.issued_by)
     is distinct from
     (new.organization_id, new.document_type, new.number, new.issued_at, new.issued_by)
  then
    raise exception 'Issued document identity is immutable (number %).', old.number
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

-- 2. Lines / withholdings: editable while the parent is not void --------------------------------------
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
  select status, organization_id into v_status, v_org from public.documents where id = v_document_id;

  -- Parent already gone (cascade delete of a draft): allow.
  if v_status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_status = 'void' then
    raise exception 'Cannot modify lines of a void document' using errcode = '55000';
  end if;

  if tg_op <> 'DELETE' and new.organization_id <> v_org then
    raise exception 'Line organization does not match the document organization' using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 3. Settlement recompute after amendments (called by the app) ----------------------------------------
grant execute on function public.recompute_document_settlement(uuid, date) to authenticated;
