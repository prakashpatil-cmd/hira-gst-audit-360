# Known limitations (incomplete modules disclosed)

1. **No live integrations.** GST portal, GSP, e-invoice/e-way bill APIs and ERP connectors are not implemented. All data enters through file imports (Excel/CSV/portal JSON). No portal login automation, by design.
2. **Not deployed.** No Supabase project or Vercel deployment was created from this build environment; prompt §23 step 20 (run on deployed staging) is pending — see DEPLOYMENT.md. The Supabase Auth path is implemented but was not exercised against a live Supabase project; tests use the local auth provider and a local Supabase-compatible shim.
3. **Seeded legal content is unverified.** 148 legal references are seeded as *pending/unverified* and must be checked and approved by a qualified professional before use in reports. Points specifically requiring review: effective dates of Rules 21A/88A–88D, IMS (1 Oct 2024), omission of Rule 96(10), ISD mandatory from 1 Apr 2025, RCM on commercial rent from 10 Oct 2024, e-invoice thresholds, Section 74A, Section 107 pre-deposit.
4. **Control library (140 controls) and observation templates (37)** are starting content requiring professional review.
5. **Heuristic classifications.** Blocked-credit (17(5)) and RCM detection use description keywords and are reported as "probable — requires investigation".
6. **Evidence-only datasets.** 24 of 37 import types (e.g. ISD, job-work/ITC-04, fixed asset register) are stored with full lineage but not materialised into typed tables or reconciled automatically.
7. **No e-mail transport.** Password reset (local auth) logs the link server-side for administrators; Supabase Auth sends its own e-mails in production. Information-request reminders are in-app only.
8. **Rate limiter is in-memory** (per instance) — use Vercel Firewall / Supabase rate limits in production.
9. **AI assistant** was not exercised against the live API in tests (no key in CI); the code path, redaction and refusal handling are unit-level only.
10. **Performance** tested on the demo dataset (thousands of rows), not on 1M-row files; very large imports should use the dedicated worker.
