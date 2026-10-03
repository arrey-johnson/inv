-- =============================================================================
-- 00009_seed_defaults.sql
-- Default Promptstack organization + baseline configuration.
--
-- IMPORTANT: legal identifiers (NIU, RCCM), address and bank details are deliberately left NULL.
-- They are filled in by an admin in Settings -> Company / Payment methods. Nothing is invented here.
-- Idempotent: safe to re-run.
-- =============================================================================

insert into public.organizations (id, legal_name, trade_name, country)
values (
  '00000000-0000-4000-8000-000000000001',
  'Promptstack Technologies',
  'Promptstack',
  'Cameroon'
)
on conflict (id) do nothing;

-- Tax rates ----------------------------------------------------------------------------------------
insert into public.tax_rates (organization_id, code, name, rate, category, is_default, is_active)
values
  ('00000000-0000-4000-8000-000000000001', 'VAT_STD',    'Standard VAT', 19.25, 'standard', true,  true),
  ('00000000-0000-4000-8000-000000000001', 'VAT_EXEMPT', 'Exempt',        0.00, 'exempt',   false, true)
on conflict (organization_id, code) do nothing;

-- Organization settings (bank / mobile money fields intentionally empty) ------------------------------------
insert into public.organization_settings (organization_id, default_tax_rate_id)
select
  '00000000-0000-4000-8000-000000000001',
  (select id from public.tax_rates
     where organization_id = '00000000-0000-4000-8000-000000000001' and code = 'VAT_STD')
on conflict (organization_id) do nothing;

-- Document numbering: PS-INV-2026-0001, PS-PF-2026-0001, ... (yearly reset, 4 digits) -------------------------
insert into public.document_sequences
  (organization_id, document_type, prefix, separator, include_year, reset_yearly, padding, start_number)
values
  ('00000000-0000-4000-8000-000000000001', 'invoice',     'PS-INV', '-', true, true, 4, 1),
  ('00000000-0000-4000-8000-000000000001', 'proforma',    'PS-PF',  '-', true, true, 4, 1),
  ('00000000-0000-4000-8000-000000000001', 'credit_note', 'PS-CN',  '-', true, true, 4, 1),
  ('00000000-0000-4000-8000-000000000001', 'receipt',     'PS-RCP', '-', true, true, 4, 1),
  ('00000000-0000-4000-8000-000000000001', 'advance',     'PS-ADV', '-', true, true, 4, 1)
on conflict (organization_id, document_type) do nothing;

-- No withholding types are seeded: rates are statutory and must be confirmed by the accountant.
