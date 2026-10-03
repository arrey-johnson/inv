# Implementation Status

Last updated: 2026-10-03

## Live Supabase (wired)

- Project: `iweekwnmkcmlxiwswrav` — `DEMO_MODE=false`
- Migrations **00001–00012** applied (verified in `schema_migrations`)
- RPCs present: `sync_overdue`, `record_payment`, `void_payment`, `void_document`, `apply_credit_note`, `apply_advance`
- Private storage: letterhead + stamp uploaded; `brand_assets` registered
- Admin: `hello@promptstacktechnologies.com` (role `admin`)
- Company: NIU `M092618963164E`, RCCM `CM-DLA-01-2026-B12-00758`, Rue Copseco, Bonapriso, Douala
- UI logos: color on login, white on sidebar (`public/brand/`)
- Dev server: http://localhost:3001 (`npm run dev:webpack`)
- Tests: **180 passed** (vitest)

## Phase overview

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: scaffold, schema, finance engine, PDF engine, auth, RBAC, shell | **Done** |
| 2 | Customers, items, settings CRUD, document builder, issue, PDF, demo mode | **Done** (live + demo) |
| 3 | Payments, overdue/aging, statements, activity timeline | **Done** (demo verified; SQL live) |
| 4 | Credit notes, advances, withholding | **Done** (demo verified; SQL live) |
| 5 | Dashboard, reports (CSV/Excel), email, public links, void, proforma responses | **Done** (demo verified; SQL live) |
| 6 | Tax authority integration, recurring schedules, hardening, E2E | Planned (no fake DGI API) |

## Completed capabilities

- Auth + RBAC (admin / accountant / sales / viewer)
- Company settings, tax rates (19.25% VAT), branding (private stamp/letterhead), numbering, payment methods
- Customers and products/services CRUD
- Proforma + invoice builder with Decimal.js totals, draft → approve → issue, convert, duplicate
- PDF on official Promptstack letterhead with stamp on issued documents
- Payments (full/partial/multi), overpayment blocked, overdue sync, aging, customer statement PDF
- Credit notes, advance invoices, optional withholding (net payable only)
- Dashboard KPIs + 10 reports with CSV/Excel export
- Email abstraction (Resend / demo outbox; SMTP not implemented)
- Secure public document links (create/revoke)

## Remaining gaps

1. Live Supabase UI acceptance path for payments/credits/advances not fully click-tested after `00012` (RPCs confirmed).
2. Refunds / customer credit balance not modelled when a credit note overshoots a partly paid invoice.
3. Advance deduction is post-issue (“Deduct advance”), not in the builder.
4. SMTP not implemented (Resend only when configured).
5. No DGI / tax-authority submission (VAT report is an accounting aid only).
6. Withholding types must be added by an admin (none seeded).
7. Windows Application Control blocks native Next SWC → use `npm run dev:webpack`.
8. Spot-check PDF stamp/letterhead placement by eye (`WRITE_SAMPLE_PDF=1 npx vitest run src/lib/pdf`).
9. Bank/payment destinations still need configuring in Settings → Payment Methods if empty.
10. `src/types/database.ts` is hand-written; replace with `supabase gen types` when convenient.

## Demo mode

Set `DEMO_MODE=true` (and optionally `DEMO_ROLE=admin`) then `npm run dev:webpack`. Data in `.data/` (delete to reset).
