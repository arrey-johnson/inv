-- =============================================================================
-- 00006_support_tables.sql
-- Attachments, email log, audit log, recurring schedules (future), tax authority submissions.
-- =============================================================================

-- attachments -----------------------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  entity_type      text not null check (entity_type in ('document', 'customer', 'payment', 'item')),
  entity_id        uuid not null,
  storage_bucket   text not null default 'attachments',
  storage_path     text not null,
  file_name        text not null,
  mime_type        text,
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  uploaded_by      uuid,
  created_at       timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (organization_id, entity_type, entity_id);

-- email_logs -------------------------------------------------------------------------------------
create table public.email_logs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  document_id          uuid references public.documents(id) on delete set null,
  customer_id          uuid references public.customers(id) on delete set null,
  to_emails            text[] not null,
  cc_emails            text[] not null default '{}',
  subject              text not null,
  template             text,
  status               public.email_status not null default 'queued',
  provider             text,
  provider_message_id  text,
  error_message        text,
  sent_by              uuid,
  sent_at              timestamptz,
  created_at           timestamptz not null default now()
);
create index email_logs_document_idx on public.email_logs (document_id);
create index email_logs_org_created_idx on public.email_logs (organization_id, created_at desc);
create index email_logs_status_idx on public.email_logs (organization_id, status) where status in ('queued', 'failed');

-- audit_logs (append-only) ----------------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete set null,
  actor_id         uuid,
  actor_email      text,
  action           text not null,                 -- e.g. document.issue, payment.void, settings.update
  entity_type      text not null,
  entity_id        text,
  before_data      jsonb,
  after_data       jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (organization_id, action);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger trg_audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();
create trigger trg_audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_log_mutation();

-- recurring_schedules (future feature - schema reserved) ----------------------------------------------------
create table public.recurring_schedules (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  customer_id           uuid not null references public.customers(id) on delete cascade,
  template_document_id  uuid not null references public.documents(id) on delete restrict,
  frequency             public.recurrence_frequency not null,
  interval_count        integer not null default 1 check (interval_count >= 1),
  start_date            date not null,
  end_date              date,
  next_run_date         date not null,
  last_run_at           timestamptz,
  auto_issue            boolean not null default false,
  auto_send             boolean not null default false,
  is_active             boolean not null default true,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index recurring_schedules_due_idx on public.recurring_schedules (next_run_date) where is_active;
create index recurring_schedules_org_idx on public.recurring_schedules (organization_id, customer_id);
create trigger trg_recurring_schedules_updated_at before update on public.recurring_schedules
  for each row execute function public.set_updated_at();

-- tax_authority_submissions (DGI e-invoicing hooks - future) -----------------------------------------------------
create table public.tax_authority_submissions (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  document_id          uuid not null references public.documents(id) on delete restrict,
  authority            text not null default 'DGI',
  status               public.submission_status not null default 'pending',
  attempts             integer not null default 0 check (attempts >= 0),
  external_reference   text,
  request_payload      jsonb,
  response_payload     jsonb,
  error_message        text,
  submitted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index tax_submissions_document_idx on public.tax_authority_submissions (document_id);
create index tax_submissions_status_idx on public.tax_authority_submissions (organization_id, status)
  where status in ('pending', 'failed');
create trigger trg_tax_submissions_updated_at before update on public.tax_authority_submissions
  for each row execute function public.set_updated_at();
