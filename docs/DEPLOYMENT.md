# Deployment

Environments: **dev** (local Postgres, `AUTH_PROVIDER=local`), **staging** and **production** (Supabase + Vercel, `AUTH_PROVIDER=supabase`). Use separate Supabase projects for staging and production.

## 1. Supabase

1. Create a project (region: Mumbai `ap-south-1` recommended for data residency).
2. Apply migrations: `supabase link --project-ref <ref> && supabase db push` (or `DATABASE_URL=<direct connection> npm run db:migrate` — do **not** set `DB_LOCAL_SHIM` against Supabase).
3. Auth: disable public sign-ups, enable TOTP MFA, set Site URL and redirect URL `https://<domain>/auth/callback` (see `supabase/config.toml`).
4. Seed: `DATABASE_URL=… SEED_ADMIN_EMAIL=… npm run db:seed` — creates the firm, the Super Administrator profile, controls, templates and (pending) rules/legal references. Invite the administrator through Supabase Auth with the same e-mail.
5. Storage: migration 0006 creates the private bucket `audit-files`. Confirm it is **not public**.

## 2. Vercel

1. Import the GitHub repository; framework Next.js.
2. Environment variables (Production and Preview separately) — see `.env.example`:
   `APP_ENV=production, APP_URL, DATABASE_URL (pooled, port 6543), AUTH_PROVIDER=supabase, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STORAGE_PROVIDER=supabase, SESSION_SECRET, CRON_SECRET, INLINE_JOBS=false`, optionally `AI_PROVIDER=anthropic, ANTHROPIC_API_KEY, CLAMAV_HOST`.
3. `vercel.json` schedules `/api/cron/jobs` every 5 minutes (authorised by `CRON_SECRET`). Jobs are also kicked immediately after queueing via `after()`.
4. For large engagements run a dedicated worker (`npm run worker`) on a container host with the same env; it drains the same durable queue.

## 3. Verification (prompt §23 step 20)

```bash
E2E_BASE_URL=https://staging.example.com E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:e2e
```
Run only against a fresh **staging** database — the suite creates clients, users and engagements.

## 4. Backups & operations

Enable Supabase point-in-time recovery. Health check: `GET /api/health`. Audit logs and login history are visible under Administration.
