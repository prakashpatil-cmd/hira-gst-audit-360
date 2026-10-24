import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Supabase Auth client bound to the request cookies (server components, actions, route handlers). */
export async function supabaseServer() {
  const e = env();
  const store = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const c of list) store.set(c.name, c.value, c.options); } catch { /* read-only in server components */ }
      },
    },
  });
}

export interface SupabaseSession { userId: string; mfaVerified: boolean; mfaEnrolled: boolean }

export async function supabaseSession(): Promise<SupabaseSession | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getUser();     // validates the JWT with the Auth server
  if (error || !data.user) return null;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const enrolled = aal?.nextLevel === "aal2";
  return { userId: data.user.id, mfaEnrolled: enrolled, mfaVerified: !enrolled || aal?.currentLevel === "aal2" };
}
