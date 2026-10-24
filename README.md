# HIRA GST Audit 360°

**Every Transaction Verified. Every GST Risk Identified.**

HIRA Associates' GST Health Check, audit, reconciliation and compliance management platform. Auditors import a client's accounting and GST records, reconcile them document by document, investigate exceptions down to the original source row, draft and review observations with deterministic tax/interest calculations, and issue a HIRA-branded PDF report with Excel working-paper annexures.

The software assists professional auditors. It does not replace their judgement, does not issue "100% compliant" certificates, and never treats AI output or unverified law as a conclusion.

---

## What works today

| Area | Status |
|---|---|
| Authentication (Supabase Auth in production; local provider for dev/CI), password policy, account lockout, TOTP MFA, password recovery, session idle timeout, sign-in history | ✅ |
| Roles: Super Administrator, Audit Manager, GST Auditor, Audit Assistant, Client User; Postgres Row Level Security on every table; client segregation tested | ✅ |
| Client master, GST registrations (checksum + PAN validation), places of business, notices & litigation register with appeal clock | ✅ |
| Engagements: scope, team assignment, 8-stage workflow, rule & control versions pinned per engagement, document request list generated from the client profile | ✅ |
| Import Centre: Excel/CSV/GST-portal JSON (GSTR-1, GSTR-2B), header detection, automatic + saved column mapping, row-level validation, quality report, versioned imports (replace/append), full row lineage | ✅ (37 record types; 13 materialise into typed tables, the rest are stored with lineage as evidence) |
| Reconciliation engine: Books vs GSTR-1 (incl. B2CS aggregates), GSTR-1 vs GSTR-3B (incl. timing differences), Purchase register vs GSTR-2B vs GSTR-3B, E-invoice vs GSTR-1 vs books, E-way bills vs sales, Imports & exports (BOE, shipping bills, ICEGATE, Rule 96A), Trial balance & ledgers | ✅ |
| Specialist checks: Section 17(5) blocked credit, RCM on import of services and notified services, credit-note rules (34(2), dated before invoice, HSN mismatch), rate consistency, tax head vs place of supply, invalid GSTINs, fixed-asset disposals (18(6)/Rule 44(6)) | ✅ (keyword-based classifications are flagged "probable/requires investigation") |
| Exception register with triage, assignment, carry-forward across re-runs, Excel export, drill-down to original file rows | ✅ |
| Control library: 140 controls across modules A–Q, versioned; checklist with evidence-adjusted coverage score | ✅ (seeded content requires professional review — see Known limitations) |
| Statutory calculators: Section 50 interest, 16(4)/34(2)/37(3) cut-off, 73/74 vs 74A limitation by FY, potential penalty, appeal timelines, 18(6) disposal tax | ✅ (rules seeded as "pending approval" until a Super Administrator approves them) |
| Observations: A–H structure, immutable calculation snapshots, evidence, management responses, corrective actions, review workflow with segregation of duties, locking | ✅ |
| Financial Impact at a Glance (A–J) without misleading netting; reproduces the Tosoh India reference figures exactly (regression test) | ✅ |
| PDF report (Tosoh layout: cover, index, management summary, impact table, top five, scope, methodology, summary table, detailed observations, action plan, roadmap, coverage, closing, revision history, DRAFT/FINAL, watermark, page X of Y) and 13-sheet Excel annexures | ✅ |
| Firm dashboard with drill-down, legal research library with approval, observation library, rule-engine console, user administration, settings, security & audit logs, client response portal | ✅ |
| Optional AI assistant "HIRA GST Intelligence" (Claude), off by default, client data redacted unless allowed, human approval required | ✅ (requires `ANTHROPIC_API_KEY`) |
| Live GST portal / GSP / ERP API integrations | ❌ Not implemented — file-based imports only (see Known limitations) |
| Deployed Vercel + Supabase instance | ❌ Not performed in this build environment — instructions in `docs/DEPLOYMENT.md` |

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md)

---

## Quick start (local)

Requirements: Node 20+, PostgreSQL 15+.

```bash
npm install
cp .env.example .env.local            # set DATABASE_URL, SESSION_SECRET (64 hex chars), CRON_SECRET
createdb hira_gst
npm run db:migrate                    # DB_LOCAL_SHIM=true applies the local Supabase shim + local auth tables
SEED_ADMIN_EMAIL=you@firm.in SEED_ADMIN_PASSWORD='Choose@Strong1' npm run db:seed
npm run demo:data                     # synthetic three-GSTIN manufacturer with planted exceptions → samples/demo
npm run dev                           # http://localhost:3000
npm run worker                        # optional: background worker (INLINE_JOBS=true runs jobs in-request for dev)
```

### Demonstration walk-through

1. Sign in as the Super Administrator. **User administration** → create a manager and two auditors.
2. **Client master** → New client (PAN `AABCH2468K`, tick exporter/importer/e-invoicing) → add GSTINs `27AABCH2468K1ZD`, `29AABCH2468K1Z9`, `19AABCH2468K1ZH` (shown in `samples/demo/EXPECTED.md`).
3. **Engagements** → New engagement (1 Apr 2026 – 30 Jun 2026), assign the team. The control checklist and document request list are generated.
4. **Data import** → upload the files in `samples/demo` (Maharashtra GSTIN; GSTR-2B files in append mode). Validate → Commit.
5. **Reconciliation** → Run all reconciliations. **Exceptions** → every planted exception listed in `EXPECTED.md` appears with drill-down to the source rows.
6. Draft observations from exceptions, add evidence and actions, submit; approve as manager; **Report builder** → create, submit, approve (Super Administrator) → download the PDF and annexures.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` | Apply migrations (`--reset` drops everything; refused unless `DB_LOCAL_SHIM=true`) |
| `npm run db:seed` | Firm, settings, Super Administrator, rules, control library, legal references, templates (idempotent) |
| `npm run demo:data` | Generate synthetic demo files and the answer key |
| `npm run worker` | Durable job worker (imports, reconciliations, reports) |
| `npm test` | Unit + integration tests (Vitest; needs the test database in `.env.test`) |
| `npm run test:e2e` | Browser acceptance test of the §23 workflow (Playwright) |
| `npm run typecheck` | TypeScript |

## Tests

* **Unit** — GSTIN checksum, money in paise and Indian formatting, date parsing (rejects 31/06/2026), document normalisation, matcher (one-to-many, duplicates, tolerance, GSTIN mismatch, fuzzy), every reconciliation and specialist check, the Tosoh financial-impact regression.
* **Integration** (real PostgreSQL) — RLS client segregation, append-only audit log, import → validate → commit → reconcile with source drill-down, reproducible runs with triage carry-forward, supersede on re-import, the full demo dataset detecting all 30 planted exceptions, observation drafting with immutable snapshots, PDF and Excel generation.
* **End-to-end** (Playwright, production build) — prompt §23 steps 1–19 through the UI.

```bash
createdb hira_gst_test && DOTENV_PATH=.env.test npm run db:migrate
npm test
npm run build && npm run test:e2e
```

## Project structure

```
src/app/(auth)          login, MFA, password recovery
src/app/(app)           firm dashboard, clients, engagements (+ 14 engagement workspaces), libraries, admin
src/app/(portal)        client response portal
src/app/api             file download (RLS-checked), job status, exports, cron, health
src/lib/db              postgres.js access; withUser() runs every query as `authenticated` under RLS
src/lib/auth            providers (Supabase / local), sessions, MFA, permissions
src/lib/import          dataset catalogue, parsers (xlsx/csv/portal JSON), normaliser, service (jobs)
src/lib/recon           matcher, reconcilers, specialist checks, runner (persist, carry-forward, checklist)
src/lib/rules           statutory calculators (interest, limitation, penalty, cut-offs)
src/lib/reports         snapshot, PDF (react-pdf + pdf-lib), Excel annexures, job
supabase/migrations     schema, RLS, audit triggers, storage bucket
db/local                local-only Supabase shim and local-auth tables
db/seed                 control library, legal references, observation templates (JSON)
samples/                demo dataset, blank import templates
tests/                  unit, integration, e2e
```

---

HIRA Associates | Your GST Compliance Partner · Adv Prakash Patil, GST Consultant | +91 98332 29199 · www.hiraassociates.in
