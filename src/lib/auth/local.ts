import "server-only";
import { serviceSql } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, randomToken, sha256, verifyPassword, verifyTotp } from "./password";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ABSOLUTE_HOURS = 12;

export type LoginResult =
  | { ok: true; token: string; userId: string; mfaRequired: boolean }
  | { ok: false; error: string };

export async function localLogin(email: string, password: string, ip: string | null, ua: string | null): Promise<LoginResult> {
  const sql = serviceSql();
  const generic = "Invalid email or password.";
  const [row] = await sql<{ user_id: string; password_hash: string; totp_secret: string | null; failed_attempts: number;
    locked_until: string | null; is_active: boolean }[]>`
    select c.user_id, c.password_hash, c.totp_secret, c.failed_attempts, c.locked_until, u.is_active
    from local_auth.credentials c join public.users u on u.id = c.user_id
    where lower(u.email) = lower(${email.trim()})`;
  if (!row) {
    await sql`insert into public.login_events (email, event, ip, user_agent) values (${email}, 'login_failure', ${ip}, ${ua})`;
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"); // equalise timing
    return { ok: false, error: generic };
  }
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { ok: false, error: "Account temporarily locked after repeated failed attempts. Try again later or contact your administrator." };
  }
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid || !row.is_active) {
    const failed = row.failed_attempts + 1;
    const lock = failed >= MAX_FAILED;
    await sql`update local_auth.credentials set failed_attempts = ${lock ? 0 : failed},
      locked_until = ${lock ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : null} where user_id = ${row.user_id}`;
    await sql`insert into public.login_events (user_id, email, event, ip, user_agent)
      values (${row.user_id}, ${email}, ${lock ? "account_locked" : "login_failure"}, ${ip}, ${ua})`;
    return { ok: false, error: row.is_active ? generic : "This account is disabled." };
  }
  const token = randomToken();
  const mfaRequired = !!row.totp_secret;
  await sql.begin(async (tx) => {
    await tx`update local_auth.credentials set failed_attempts = 0, locked_until = null where user_id = ${row.user_id}`;
    await tx`insert into local_auth.sessions (token_hash, user_id, mfa_verified, expires_at, ip, user_agent)
      values (${sha256(token)}, ${row.user_id}, ${!mfaRequired}, now() + make_interval(hours => ${ABSOLUTE_HOURS}), ${ip}, ${ua})`;
    await tx`update public.users set last_login_at = now() where id = ${row.user_id}`;
    await tx`insert into public.login_events (user_id, email, event, ip, user_agent) values (${row.user_id}, ${email}, 'login_success', ${ip}, ${ua})`;
  });
  return { ok: true, token, userId: row.user_id, mfaRequired };
}

export interface LocalSession { userId: string; mfaVerified: boolean; mfaEnrolled: boolean }

export async function localSession(token: string | undefined): Promise<LocalSession | null> {
  if (!token) return null;
  const sql = serviceSql();
  const idle = env().SESSION_IDLE_MINUTES;
  const [s] = await sql<{ user_id: string; mfa_verified: boolean; totp: boolean }[]>`
    update local_auth.sessions s set last_seen_at = now()
    from public.users u, local_auth.credentials c
    where s.token_hash = ${sha256(token)} and u.id = s.user_id and c.user_id = s.user_id and u.is_active
      and s.expires_at > now() and s.last_seen_at > now() - make_interval(mins => ${idle})
    returning s.user_id, s.mfa_verified, (c.totp_secret is not null) as totp`;
  if (!s) return null;
  return { userId: s.user_id, mfaVerified: s.mfa_verified, mfaEnrolled: s.totp };
}

export async function localVerifyMfa(token: string, code: string): Promise<boolean> {
  const sql = serviceSql();
  const [row] = await sql<{ user_id: string; totp_secret: string | null }[]>`
    select s.user_id, c.totp_secret from local_auth.sessions s join local_auth.credentials c on c.user_id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  if (!row?.totp_secret) return false;
  const ok = verifyTotp(row.totp_secret, code);
  await sql`insert into public.login_events (user_id, event) values (${row.user_id}, ${ok ? "mfa_success" : "mfa_failure"})`;
  if (ok) await sql`update local_auth.sessions set mfa_verified = true where token_hash = ${sha256(token)}`;
  return ok;
}

export async function localLogout(token: string | undefined) {
  if (!token) return;
  const sql = serviceSql();
  const [s] = await sql<{ user_id: string }[]>`delete from local_auth.sessions where token_hash = ${sha256(token)} returning user_id`;
  if (s) await sql`insert into public.login_events (user_id, event) values (${s.user_id}, 'logout')`;
}

export async function localSetPassword(userId: string, password: string) {
  const sql = serviceSql();
  const hash = await hashPassword(password);
  await sql`insert into local_auth.credentials (user_id, password_hash) values (${userId}, ${hash})
    on conflict (user_id) do update set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null, updated_at = now()`;
  await sql`delete from local_auth.sessions where user_id = ${userId}`;
}

/** Creates a single-use reset token (valid 30 min). Delivery is by email in Supabase mode; see README for local mode. */
export async function localCreateReset(email: string): Promise<{ token: string; userId: string } | null> {
  const sql = serviceSql();
  const [u] = await sql<{ id: string }[]>`select id from public.users where lower(email) = lower(${email}) and is_active`;
  if (!u) return null;
  const token = randomToken();
  await sql`insert into local_auth.password_resets (token_hash, user_id, expires_at) values (${sha256(token)}, ${u.id}, now() + interval '30 minutes')`;
  await sql`insert into public.login_events (user_id, email, event) values (${u.id}, ${email}, 'password_reset_requested')`;
  return { token, userId: u.id };
}

export async function localConsumeReset(token: string, newPassword: string): Promise<boolean> {
  const sql = serviceSql();
  const [r] = await sql<{ user_id: string }[]>`update local_auth.password_resets set used_at = now()
    where token_hash = ${sha256(token)} and used_at is null and expires_at > now() returning user_id`;
  if (!r) return false;
  await localSetPassword(r.user_id, newPassword);
  await sql`insert into public.login_events (user_id, event) values (${r.user_id}, 'password_reset_completed')`;
  return true;
}

export async function localSetTotp(userId: string, secret: string | null) {
  await serviceSql()`update local_auth.credentials set totp_secret = ${secret}, updated_at = now() where user_id = ${userId}`;
}
