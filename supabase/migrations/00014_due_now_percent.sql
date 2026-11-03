-- =============================================================================
-- 00014_due_now_percent.sql
-- Optional staged payment schedule on commercial documents: show full TTC, but
-- highlight that only X% is due now (remainder later). Does not change settlement
-- math — balance_due stays full net_payable until payments / advances / credits.
-- =============================================================================

alter table public.documents
  add column if not exists due_now_percent numeric(5,2)
    check (due_now_percent is null or (due_now_percent > 0 and due_now_percent <= 100));

comment on column public.documents.due_now_percent is
  'Optional share of net_payable due on issue (e.g. 40). NULL = full amount due. Printed on PDF; settlement still tracks the full balance.';
