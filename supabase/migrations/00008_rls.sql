-- =============================================================================
-- 00008_rls.sql
-- Row Level Security for every table.
--
-- Role matrix (keep in sync with src/lib/auth/rbac.ts):
--   admin       full access, including settings and users
--   accountant  finance: documents, payments, credit/advance links, read settings, audit log
--   sales       customers, items, document drafts, links, email; NO payments
--   viewer      read-only
--
-- Public document links (document/[token]) never touch RLS: the server validates the token hash
-- and reads with the service role. `anon` has no table access at all.
-- =============================================================================

-- Enable RLS everywhere ---------------------------------------------------------------------------
alter table public.organizations                enable row level security;
alter table public.organization_settings        enable row level security;
alter table public.brand_assets                 enable row level security;
alter table public.profiles                     enable row level security;
alter table public.user_roles                   enable row level security;
alter table public.customers                    enable row level security;
alter table public.items                        enable row level security;
alter table public.tax_rates                    enable row level security;
alter table public.withholding_types            enable row level security;
alter table public.document_sequences           enable row level security;
alter table public.document_sequence_counters   enable row level security;
alter table public.documents                    enable row level security;
alter table public.document_items               enable row level security;
alter table public.document_withholdings        enable row level security;
alter table public.payments                     enable row level security;
alter table public.payment_allocations          enable row level security;
alter table public.credit_note_links            enable row level security;
alter table public.advance_links                enable row level security;
alter table public.document_links               enable row level security;
alter table public.attachments                  enable row level security;
alter table public.email_logs                   enable row level security;
alter table public.audit_logs                   enable row level security;
alter table public.recurring_schedules          enable row level security;
alter table public.tax_authority_submissions    enable row level security;

-- Defense in depth: the anonymous role gets nothing, ever.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Shorthand used below:
--   writers = admin, accountant, sales        finance = admin, accountant

-- organizations ---------------------------------------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['admin']::public.user_role[]))
  with check (public.has_org_role(id, array['admin']::public.user_role[]));

-- organization_settings -----------------------------------------------------------------------------------
create policy org_settings_select on public.organization_settings
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy org_settings_insert on public.organization_settings
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy org_settings_update on public.organization_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- brand_assets ---------------------------------------------------------------------------------------------------
create policy brand_assets_select on public.brand_assets
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy brand_assets_insert on public.brand_assets
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy brand_assets_update on public.brand_assets
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy brand_assets_delete on public.brand_assets
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- profiles -------------------------------------------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (organization_id is not null and public.is_org_member(organization_id))
  );
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    or (organization_id is not null and public.has_org_role(organization_id, array['admin']::public.user_role[]))
  )
  with check (
    id = (select auth.uid())
    or (organization_id is not null and public.has_org_role(organization_id, array['admin']::public.user_role[]))
  );

-- user_roles -----------------------------------------------------------------------------------------------------------------
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy user_roles_update on public.user_roles
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- customers ------------------------------------------------------------------------------------------------------------------------
create policy customers_select on public.customers
  for select to authenticated using (public.is_org_member(organization_id));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy customers_update on public.customers
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy customers_delete on public.customers
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- items -----------------------------------------------------------------------------------------------------------------------------------
create policy items_select on public.items
  for select to authenticated using (public.is_org_member(organization_id));
create policy items_insert on public.items
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy items_update on public.items
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy items_delete on public.items
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- tax_rates / withholding_types (read: all members, write: admin) -----------------------------------------------------------------------------
create policy tax_rates_select on public.tax_rates
  for select to authenticated using (public.is_org_member(organization_id));
create policy tax_rates_insert on public.tax_rates
  for insert to authenticated with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy tax_rates_update on public.tax_rates
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy tax_rates_delete on public.tax_rates
  for delete to authenticated using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

create policy withholding_types_select on public.withholding_types
  for select to authenticated using (public.is_org_member(organization_id));
create policy withholding_types_insert on public.withholding_types
  for insert to authenticated with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy withholding_types_update on public.withholding_types
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy withholding_types_delete on public.withholding_types
  for delete to authenticated using (public.has_org_role(organization_id, array['admin']::public.user_role[]));

-- document_sequences (config: members read, admin write) / counters (finance read, function-only write) -----------------------------------
create policy document_sequences_select on public.document_sequences
  for select to authenticated using (public.is_org_member(organization_id));
create policy document_sequences_insert on public.document_sequences
  for insert to authenticated with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));
create policy document_sequences_update on public.document_sequences
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.user_role[]));

create policy document_sequence_counters_select on public.document_sequence_counters
  for select to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
-- no insert/update/delete policies: only allocate_document_number() (SECURITY DEFINER) writes counters.

-- documents --------------------------------------------------------------------------------------------------------------------------------------
create policy documents_select on public.documents
  for select to authenticated using (public.is_org_member(organization_id));
create policy documents_insert on public.documents
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy documents_update on public.documents
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy documents_delete on public.documents
  for delete to authenticated
  using (
    status = 'draft'
    and public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[])
  );

-- document_items / document_withholdings ---------------------------------------------------------------------------------------------------------------------
create policy document_items_select on public.document_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy document_items_insert on public.document_items
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy document_items_update on public.document_items
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy document_items_delete on public.document_items
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));

create policy document_withholdings_select on public.document_withholdings
  for select to authenticated using (public.is_org_member(organization_id));
create policy document_withholdings_insert on public.document_withholdings
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy document_withholdings_update on public.document_withholdings
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy document_withholdings_delete on public.document_withholdings
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));

-- payments / allocations / credit & advance links (finance write) ----------------------------------------------------------------------------------------------
create policy payments_select on public.payments
  for select to authenticated using (public.is_org_member(organization_id));
create policy payments_insert on public.payments
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy payments_update on public.payments
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
-- payments are voided, never deleted: no delete policy.

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated using (public.is_org_member(organization_id));
create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy payment_allocations_update on public.payment_allocations
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy payment_allocations_delete on public.payment_allocations
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

create policy credit_note_links_select on public.credit_note_links
  for select to authenticated using (public.is_org_member(organization_id));
create policy credit_note_links_insert on public.credit_note_links
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy credit_note_links_update on public.credit_note_links
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy credit_note_links_delete on public.credit_note_links
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

create policy advance_links_select on public.advance_links
  for select to authenticated using (public.is_org_member(organization_id));
create policy advance_links_insert on public.advance_links
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy advance_links_update on public.advance_links
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy advance_links_delete on public.advance_links
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

-- document_links (writers) --------------------------------------------------------------------------------------------------------------------------------------------
create policy document_links_select on public.document_links
  for select to authenticated using (public.is_org_member(organization_id));
create policy document_links_insert on public.document_links
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy document_links_delete on public.document_links
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

-- attachments ----------------------------------------------------------------------------------------------------------------------------------------------------------------
create policy attachments_select on public.attachments
  for select to authenticated using (public.is_org_member(organization_id));
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

-- email_logs --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create policy email_logs_select on public.email_logs
  for select to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy email_logs_insert on public.email_logs
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));
create policy email_logs_update on public.email_logs
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant','sales']::public.user_role[]));

-- audit_logs: finance read, members append their own entries (rows are immutable via trigger) --------------------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    organization_id is not null
    and public.is_org_member(organization_id)
    and actor_id = (select auth.uid())
  );

-- recurring_schedules / tax_authority_submissions ----------------------------------------------------------------------------------------------------------------------------------------
create policy recurring_schedules_select on public.recurring_schedules
  for select to authenticated using (public.is_org_member(organization_id));
create policy recurring_schedules_insert on public.recurring_schedules
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy recurring_schedules_update on public.recurring_schedules
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy recurring_schedules_delete on public.recurring_schedules
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));

create policy tax_submissions_select on public.tax_authority_submissions
  for select to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy tax_submissions_insert on public.tax_authority_submissions
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
create policy tax_submissions_update on public.tax_authority_submissions
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]))
  with check (public.has_org_role(organization_id, array['admin','accountant']::public.user_role[]));
