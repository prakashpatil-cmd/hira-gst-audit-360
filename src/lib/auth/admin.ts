import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { serviceSql, type Sql } from "@/lib/db";
import { localSetPassword } from "./local";
import { passwordPolicyErrors } from "./password";

/**
 * Creates (or finds) the identity record for a user in the configured auth provider and the
 * matching public.users profile. Supabase: auth.admin.createUser; local: auth.users + scrypt hash.
 */
export async function provisionUser(a: { email: string; fullName: string; password: string; designation?: string | null; sql?: Sql }): Promise<string> {
  const errs = passwordPolicyErrors(a.password);
  if (errs.length) throw new Error(`Password must contain ${errs.join(", ")}`);
  const sql = a.sql ?? serviceSql();
  const email = a.email.trim().toLowerCase();
  let id: string;
  if (env().AUTH_PROVIDER === "supabase") {
    const admin = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({ email, password: a.password, email_confirm: true, user_metadata: { full_name: a.fullName } });
    if (error) {
      const [existing] = await sql<{ id: string }[]>`select id from auth.users where lower(email) = ${email}`;
      if (!existing) throw new Error(`Could not create user: ${error.message}`);
      id = existing.id;
    } else id = data.user.id;
  } else {
    const [u] = await sql<{ id: string }[]>`insert into auth.users (email) values (${email})
      on conflict (email) do update set email = excluded.email returning id`;
    id = u.id;
    await localSetPassword(id, a.password);
  }
  await sql`insert into public.users (id, email, full_name, designation) values (${id}, ${email}, ${a.fullName}, ${a.designation ?? null})
    on conflict (id) do update set full_name = excluded.full_name, designation = coalesce(excluded.designation, public.users.designation)`;
  return id;
}

export async function resetUserPassword(userId: string, password: string) {
  const errs = passwordPolicyErrors(password);
  if (errs.length) throw new Error(`Password must contain ${errs.join(", ")}`);
  if (env().AUTH_PROVIDER === "supabase") {
    const admin = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);
  } else await localSetPassword(userId, password);
}
