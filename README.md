# Promptstack Technologies — Invoicing System

Production invoicing platform (proformas, invoices, credit notes, payments, advances, withholdings) for **Promptstack Technologies**. Built on Next.js 15 (App Router), TypeScript (strict), Tailwind CSS v4, shadcn/ui and Supabase (Postgres + Auth + Storage).

> Status: **Phase 1 (foundation) complete.** See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).

## Stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, React 19, TypeScript strict |
| UI | Tailwind v4, shadcn/ui (`radix-nova`), lucide-react, sonner |
| Forms | react-hook-form + zod 4 (`@hookform/resolvers`) |
| Data | Supabase (`@supabase/supabase-js`, `@supabase/ssr`), RLS on every table |
| Money | `decimal.js` (isolated clone, ROUND_HALF_UP) |
| PDF | `pdf-lib` (letterhead overlay + stamp) |
| Tables / charts / export | `@tanstack/react-table`, `recharts`, `xlsx` |
| Tests | `vitest` + `@vitest/coverage-v8` |

## Setup

### 1. Node (Windows, project-local toolchain)

Prepend the bundled Node to `PATH` in every new PowerShell session before using `npm`/`node`:

```powershell
$env:Path = "C:\Users\USER\OneDrive\Desktop\promptstacktechnologies\.tools\node-v22.19.0-win-x64;" + $env:Path
node -v   # v22.19.0
```

### 2. Install and configure

```powershell
npm install
Copy-Item .env.example .env.local
```

Fill `.env.local`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Public document links, admin tasks |
| `NEXT_PUBLIC_APP_URL` | Absolute URLs in emails/links |
| `DEFAULT_ORGANIZATION_ID` | Promptstack org id (seeded as `00000000-0000-4000-8000-000000000001`) |
| `DOCUMENT_LINK_SECRET` | >= 32 chars; HMAC key for public link token hashes |
| `BRANDING_SOURCE` | `local` (default, reads `assets/branding/source`) or `storage` (private Supabase bucket) |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | Email delivery (Phase 5) |

Without Supabase variables the app still boots (login page, `/api/health`); authenticated routes redirect to `/login`.

### 3. Database

1. Create a Supabase project.
2. Apply `supabase/migrations/00001…00010` in order (SQL editor, or `supabase db push`).
3. Create the first user in Supabase Auth, then grant admin:

```sql
insert into user_roles (user_id, organization_id, role)
values ('<auth-user-uuid>', '00000000-0000-4000-8000-000000000001', 'admin');
```

### 4. Run

```powershell
npm run dev           # Turbopack
npm run dev:webpack   # fallback if the native SWC binary is blocked (Windows Application Control)
npm run build         # production build (webpack)
npm run check         # typecheck + lint + tests
npm test              # vitest
npm run test:coverage
```

### Demo mode (no Supabase needed)

Create `.env.local` with:

```
DEMO_MODE=true
DEMO_ROLE=admin          # optional: admin | accountant | sales | viewer
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Then `npm run dev:webpack` (or `npm run dev`). Everything is stored in `.data/` (git-ignored):
`demo-db.json` (all records), `pdfs/` (issued PDFs) and `branding/` (uploaded letterhead/stamp).
Authentication is bypassed and a **DEMO MODE** banner is shown. Delete `.data/` to reset to the seed
(Promptstack organization, tax rates, numbering, starter catalog). Never use demo mode in production:
it has no real authentication. Without `DEMO_MODE`, the app requires Supabase and real logins.

Branding uploads (Settings > Branding) go to the private `branding` storage bucket when Supabase is
configured, otherwise to `.data/branding` (local fallback). The stamp is never placed in `public/`.

## Architecture

```
src/
  app/                    Routes: (auth)/login, (app)/{dashboard,sales,reports,settings},
                          document/[token] (public), api/{health,documents/[id]/pdf}, auth/callback
  components/{ui,layout,documents,customers,payments,reports,settings}
  lib/
    finance/              Pure money engine (no I/O) + tests
    pdf/                  Layout constants, renderer, mapping from stored documents
    storage/              Brand asset loading + validation (server-only)
    supabase/             client / server / middleware / admin
    auth/                 rbac, session, actions, secure document tokens, public link resolver
    audit/                Append-only audit log writer
    validations/ email/ tax-authority/ i18n/ utils/
  types/database.ts       Hand-written DB types (replace with `supabase gen types` later)
supabase/migrations/      Schema, functions, RLS, seed, storage
assets/branding/source/   Official letterhead PDF and company stamp (server-only)
```

### Finance engine (`src/lib/finance`)

- All arithmetic via `Decimal`; never JS floats.
- XAF rounds to whole francs, EUR/USD to 2 decimals.
- Line discounts first, then the global discount, allocated across lines with the largest-remainder method so allocations sum exactly.
- VAT is rounded **once per rate group**, then redistributed to lines (largest remainder).
- Withholdings are computed on the pre-tax net; `netPayable = total − withholdings`.
- Helpers: `calculateBalance`, `calculateCreditNoteCapacity`, `calculateAdvanceBalance`, `maxAdvanceApplicable`.
- Numbers: `allocate_document_number(org_id, doc_type, issue_year)` (SQL, atomic upsert-increment) and a mirrored `formatDocumentNumber`.

### Database guarantees

- RLS on every table via `is_org_member` / `has_org_role` helpers.
- `issue_document()` atomically moves draft → issued, allocates the number and snapshots party/bank/branding data.
- Triggers make issued documents and their lines immutable; payments/credit notes/advances recompute settlement.
- `audit_logs` is append-only.

### PDF and branding (private assets)

- The official letterhead PDF is embedded once and drawn behind every page; the stamp is drawn on the **last page of issued documents only**, in a reserved zone above the footer.
- **The stamp and letterhead are never placed in `public/`** and are not traced into deployments. Local default: `assets/branding/source/`. Production: private Supabase `branding` bucket (`BRANDING_SOURCE=storage`).
- A test asserts the stamp is not under `public/`; `.gitignore` blocks `public/company-stamp*`, `public/letterhead*`, `public/assets/`.
- Company legal identifiers (NIU, RCCM, address, bank details) are **not hard-coded**. They are empty/null until an admin enters them in Settings → Company.

### RBAC

| Capability | admin | accountant | sales | viewer |
| --- | :-: | :-: | :-: | :-: |
| View everything | ✓ | ✓ | ✓ | ✓ |
| Create/edit customers, items, drafts | ✓ | ✓ | ✓ | – |
| Issue documents | ✓ | ✓ | ✓ | – |
| Record payments, credit notes, advances | ✓ | ✓ | – | – |
| Void documents, view audit log | ✓ | ✓ | – | – |
| Delete customers/items, manage settings & users | ✓ | – | – | – |

Defined in `src/lib/auth/rbac.ts` and mirrored in RLS policies.

### Secure public links

`/document/[token]`: 256-bit random token; only its HMAC-SHA256 hash is stored. Expiry and revocation supported; every failure mode renders the same “Link unavailable” screen; responses are `noindex`, `no-referrer`, `no-store`. Lookups use the service role on the server only.

## Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client (`server-only` guards on admin/branding modules).
- Run the migrations against a real Supabase project and test RLS per role before going live.
- `xlsx@0.18.5` (npm) has known advisories; use it for export only, never to parse untrusted files, or swap for a maintained build.

## Roadmap

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
