# Security

## Controls implemented (tested where noted)

- **Tenancy & segregation** — Postgres RLS on every table; all user queries run as `authenticated` with the user's JWT claims (integration tests: auditor sees only assigned clients; client user sees no working papers; unassigned auditor cannot import).
- **Roles** — Super Administrator, Audit Manager, GST Auditor, Audit Assistant, Client User; server-side permission checks on every action and page.
- **Segregation of duties** — the preparer cannot approve their own observation (server action check); only a Super Administrator holds `reports.approve` (final report approval); approval of rules, control versions and legal references is restricted to Super Administrators at database level (trigger `guard_approval`).
- **Immutability** — `audit_logs` append-only; `financial_calculations` immutable; locked observations and approved report versions cannot be changed (DB triggers).
- **Authentication** — Supabase Auth in production; local provider (dev/CI only, disabled in production unless explicitly allowed): scrypt hashing, password policy, 5-attempt/15-minute lockout, TOTP MFA, idle timeout, hashed session tokens, sign-in history.
- **Files** — private storage only; downloads go through `/api/files/[id]` which checks RLS and logs the access; uploads checked by extension + magic bytes; optional ClamAV scan; size limit.
- **Secrets** — never sent to the browser; validated in `src/lib/env.ts`; nothing hard-coded. Cron endpoint uses a constant-time bearer check.
- **Headers** — CSP-friendly security headers, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (next.config.ts).
- **Logging** — application logs exclude transaction values and file contents; no third-party analytics.
- **GST portal** — no automated portal login; no OTP/CAPTCHA handling. Data enters only through files the client provides.
- **AI** — off by default; client names and GSTINs redacted unless the administrator allows; outputs are drafts requiring approval; the model is instructed not to invent data or citations, and only approved legal references are supplied.

## Checklist before go-live

- [ ] Rotate `SESSION_SECRET`, `CRON_SECRET`; store keys only in Vercel env.
- [ ] Confirm storage bucket is private; confirm Supabase sign-ups disabled and MFA enforced for staff.
- [ ] Review and approve rule definitions and legal references (Super Administrator).
- [ ] Configure ClamAV (`CLAMAV_HOST`) or accept the risk in writing.
- [ ] Penetration test of the deployed staging instance.

## Dependency audit notes

`npm audit` reports advisories in transitive dependencies: `postcss` bundled inside `next`, and `uuid` inside `exceljs`. Neither is reachable with user-controlled input in this application; track upstream releases and upgrade when fixed.
