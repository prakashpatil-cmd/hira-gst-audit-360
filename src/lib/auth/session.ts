import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { serviceSql } from "@/lib/db";
import { localSession } from "./local";
import { supabaseSession } from "./supabase";
import { can, highestRole, type Membership, type Permission, type RoleCode, type SessionUser } from "./permissions";

export const SESSION_COOKIE = "hira_session";

export async function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env().APP_ENV === "production" || env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 12 * 3600,
  };
}

async function resolveSession(): Promise<{ userId: string; mfaVerified: boolean; mfaEnrolled: boolean } | null> {
  if (env().AUTH_PROVIDER === "supabase") return supabaseSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return localSession(token);
}

/** The signed-in user (memoised per request), or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const s = await resolveSession();
  if (!s) return null;
  const sql = serviceSql();
  const [u] = await sql<{ id: string; email: string; full_name: string; is_active: boolean; mfa_enforced: boolean }[]>`
    select id, email, full_name, is_active, mfa_enforced from public.users where id = ${s.userId}`;
  if (!u || !u.is_active) return null;
  const ms = await sql<{ organisation_id: string; role_code: RoleCode; client_id: string | null }[]>`
    select organisation_id, role_code, client_id from public.memberships where user_id = ${u.id} and is_active
    order by created_at`;
  if (ms.length === 0) return null;
  const memberships: Membership[] = ms.map((m) => ({ organisationId: m.organisation_id, role: m.role_code, clientId: m.client_id }));
  const orgId = memberships[0].organisationId;
  const inOrg = memberships.filter((m) => m.organisationId === orgId);
  const role = highestRole(inOrg)!;
  return {
    id: u.id, email: u.email, fullName: u.full_name, memberships, orgId, role,
    isClientUser: role === "client_user",
    clientIds: inOrg.filter((m) => m.clientId).map((m) => m.clientId!),
    mfaEnrolled: s.mfaEnrolled,
    mfaVerified: s.mfaVerified && (!u.mfa_enforced || s.mfaEnrolled),
  };
});

/** Requires a fully authenticated staff (or portal) user; redirects otherwise. */
export async function requireUser(opts: { allowClient?: boolean } = {}): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!u.mfaVerified) redirect(u.mfaEnrolled ? "/login/mfa" : "/account/security?enrol=1");
  if (u.isClientUser && !opts.allowClient) redirect("/portal");
  return u;
}

export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const u = await requireUser({ allowClient: perm.startsWith("portal.") });
  if (!can(u, perm)) throw new ForbiddenError(`Your role (${u.role}) does not permit ${perm}`);
  return u;
}

export class ForbiddenError extends Error {
  status = 403;
}

export async function requestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), ua: h.get("user-agent") };
}
