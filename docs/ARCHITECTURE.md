# Architecture — HIRA GST Audit 360°

## 1. Overview

```
Browser ──► Next.js App Router (Vercel)
              │  Server Components / Server Actions (all data access server-side)
              │  middleware: session check / Supabase session refresh
              ▼
          src/lib/db  withUser(userId, fn)
              │  BEGIN; set_config('request.jwt.claims', {sub, role:'authenticated'});
              │  SET LOCAL ROLE authenticated;  → Postgres RLS enforces tenancy
              ▼
          Supabase Postgres  ◄── jobs table ◄── worker (npm run worker) / /api/cron/jobs / after()
          Supabase Storage (private bucket "audit-files", signed URLs only)
          Anthropic API (optional; server-side only, redacted case files)
```

* No client component touches the database or storage keys. `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY` are server-only (`src/lib/env.ts` validates them; `server-only` imports guard the modules).
* `serviceSql()` (owner connection, bypasses RLS) is used only for job processing, seeding and system tasks after an explicit authorisation check.

## 2. Modules

| Layer | Path | Responsibility |
|---|---|---|
| Auth | `src/lib/auth` | Supabase Auth or local provider (scrypt, TOTP, lockout, idle sessions); `requirePermission` / `requirePagePermission` |
| Import | `src/lib/import` | 37 dataset types, parsers (xlsx/csv/GSTR-1/GSTR-2B JSON), mapping, normalisation, validation, fingerprint duplicates, versioned commit |
| Reconciliation | `src/lib/recon` | Generic matcher (key grouping, one-to-many, tolerance per tax head, GSTIN mismatch, fuzzy), 8 reconcilers, specialist checks, deterministic runner with input hash and triage carry-forward |
| Rules | `src/lib/rules/statutory.ts` | Interest u/s 50, cut-offs 16(4)/34(2)/37(3), limitation 73/74/74A, penalty, appeal clock, 18(6) disposal tax — version `ENGINE_VERSION`, rule parameters in `rule_definitions` (approval required) |
| Observations | `src/lib/observations.ts`, `impact.ts` | A–H observation structure, impact buckets A–J, immutable calculation snapshots, summary without netting |
| Coverage | `src/lib/coverage.ts` | Evidence-adjusted coverage score (never a "100% compliant" claim) |
| Reports | `src/lib/reports` | Snapshot → PDF (react-pdf + pdf-lib page stamping) and 13-sheet Excel annexures; stored as versioned `report_versions` |
| Jobs | `src/lib/jobs` | Durable queue (`FOR UPDATE SKIP LOCKED`), retries, handlers |
| AI | `src/lib/ai.ts` | Optional; redaction; refuses to invent data; output always a draft for human approval |

## 3. Database schema (supabase/migrations)

1. **Tenancy & master** — organisations, system_settings, users, roles, memberships, login_events, clients, client_gstins, business_locations
2. **Engagements** — audit_engagements, engagement_gstins, engagement_locations, audit_assignments
3. **Data** — source_documents, import_mappings, data_imports, source_transactions (raw row + lineage), sales_invoices, purchase_invoices, credit_notes, debit_notes, gst_returns, gst_return_lines, einvoices, eway_bills, bills_of_entry, shipping_bills, ledger_balances
4. **Knowledge** — legal_references, audit_controls, control_versions, rule_definitions, engagement_rule_pins, observation_templates
5. **Work** — audit_test_results, reconciliation_runs, reconciliation_matches, reconciliation_exceptions, audit_observations, observation_evidence, financial_calculations (immutable), management_responses, review_approvals, corrective_actions, document_requests, notices, report_versions, jobs
6. **Audit** — audit_logs (append-only, written by `app.log_change()` triggers)

Migration 0007 lets managers create clients/engagements under RLS (`INSERT … RETURNING` must pass the SELECT policy); visibility is unchanged.

RLS: every table has RLS enabled. Helper functions in schema `app` (SECURITY DEFINER, stable) resolve the caller's organisations, roles, assigned engagements and portal clients. Guards: locked observations cannot change, approved report versions cannot change, approvals require the right role and cannot be self-approval.

## 4. Engagement workflow (8 stages)

Planning → Data collection → Data validation → Reconciliation & testing → Observation drafting → Review → Reporting → Closure. Stage moves are logged; a report cannot be finalised before observations are reviewed.

## 5. Development roadmap / phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, RLS, auth, client master, engagements, import centre | Done, tested |
| 2 | Reconciliation engine, exceptions, statutory calculators | Done, tested |
| 3 | Control library, checklist, observations, review workflow, impact | Done, tested |
| 4 | PDF/Excel report, dashboard, portal, libraries, admin | Done, tested (unit/integration/E2E) |
| 5 | Optional AI assistant | Implemented; live API calls not exercised in CI (no key) |
| 6 | Live integrations (GSP/ERP APIs), email transport, deployment | Not implemented — see KNOWN_LIMITATIONS.md |
