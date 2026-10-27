# Deployment

Environments: **dev** (local Postgres, `AUTH_PROVIDER=local`), **staging** and **production** (Supabase + Vercel, `AUTH_PROVIDER=supabase`). Use separate Supabase projects for staging and production.

## 0. Quick path (no command line needed)

1. **Supabase** → New project (region **Mumbai / ap-south-1**). Then **SQL Editor → New query**, paste and **Run** each file in `supabase/setup/` in order (part1 … part5), one query at a time — paste the file *contents*, not its name. (`supabase/setup.sql` is the same thing as a single file, for tools that can run large scripts.).
2. **Authentication → Users → Add user → Create new user** (your e-mail, strong password, *Auto Confirm User*). Then run `supabase/link-admin.sql` in the SQL Editor (edit the e-mail inside first if different) — this makes that login the Super Administrator.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". **Authentication → URL Configuration**: Site URL `https://hira-gst-audit-360.vercel.app`, Redirect URL `https://hira-gst-audit-360.vercel.app/auth/callback`.
4. **Vercel → project hira-gst-audit-360 → Settings → Environment Variables** (Production and Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → API), `SUPABASE_SERVICE_ROLE_KEY` (same page, mark *Sensitive*), `DATABASE_URL` = the **Transaction pooler** connection string from Supabase → Connect (port 6543, with your database password; mark *Sensitive*). `APP_ENV`, `APP_URL`, `AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, `INLINE_JOBS=false`, `SESSION_SECRET` and `CRON_SECRET` are already set.
5. Connect the GitHub repository to the Vercel project and deploy. The `NEXT_PUBLIC_*` values are built into the page, so set them **before** the first deployment (or redeploy after setting them).

`vercel.json` runs the background-job cron once a day (the Hobby plan limit); jobs normally start immediately after each request. On Vercel Pro you can change the schedule to `*/5 * * * *`.

## 1. Supabase (command-line alternative)

1. Create a project (region: Mumbai `ap-south-1` recommended for data residency).
2. Apply migrations: `supabase link --project-ref <ref> && supabase db push` (or `DATABASE_URL=<direct connection> npm run db:migrate` — do **not** set `DB_LOCAL_SHIM` against Supabase).
3. Auth: disable public sign-ups, enable TOTP MFA, set Site URL and redirect URL `https://<domain>/auth/callback` (see `supabase/config.toml`).
4. Seed: `DATABASE_URL=… SEED_ADMIN_EMAIL=… npm run db:seed` — creates the firm, the Super Administrator profile, controls, templates and (pending) rules/legal references. Invite the administrator through Supabase Auth with the same e-mail.
5. Storage: migration 0006 creates the private bucket `audit-files`. Confirm it is **not public**.

## 2. Vercel

1. Import the GitHub repository; framework Next.js.
2. Environment variables (Production and Preview separately) — see `.env.example`:
   `APP_ENV=production, APP_URL, DATABASE_URL (pooled, port 6543), AUTH_PROVIDER=supabase, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STORAGE_PROVIDER=supabase, SESSION_SECRET, CRON_SECRET, INLINE_JOBS=false`, optionally `AI_PROVIDER=anthropic, ANTHROPIC_API_KEY, CLAMAV_HOST`.
3. `vercel.json` schedules `/api/cron/jobs` daily (Hobby plan limit; authorised by `CRON_SECRET`). Jobs are also kicked immediately after queueing via `after()`.
4. For large engagements run a dedicated worker (`npm run worker`) on a container host with the same env; it drains the same durable queue.

## 3. Verification (prompt §23 step 20)

```bash
E2E_BASE_URL=https://staging.example.com E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:e2e
```
Run only against a fresh **staging** database — the suite creates clients, users and engagements.

## 4. Backups & operations

Enable Supabase point-in-time recovery. Health check: `GET /api/health`. Audit logs and login history are visible under Administration.
