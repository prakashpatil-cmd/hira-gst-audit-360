# Release notes

## 0.1.0 — 24 Oct 2026 (first working release)

- Supabase-compatible schema (7 migrations) with RLS on every table, audit triggers and immutability guards.
- Authentication (Supabase / local), MFA, lockout, roles and permissions; client portal.
- Client master, GSTIN validation, notices register; engagements with 8-stage workflow, team assignment, pinned rule/control versions, generated document requests.
- Import Centre: 37 dataset types, mapping, validation, quality report, versioning, lineage.
- Reconciliation engine: 8 reconciliation types + specialist checks; exception register with triage and carry-forward.
- Control library (A–Q), checklist and evidence-adjusted coverage.
- Observations A–H with immutable calculations, review workflow, management responses, corrective actions.
- Financial Impact at a Glance (A–J) — matches the Tosoh India reference figures.
- HIRA-branded PDF report and 13-sheet Excel annexures; firm dashboard; libraries; rule console; admin.
- Optional AI assistant (off by default).
- Tests: unit + integration (Vitest, real Postgres) and Playwright acceptance of §23 steps 1–19.

See KNOWN_LIMITATIONS.md for what is not included.
