"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { serviceSql } from "@/lib/db";
import { run } from "@/lib/actions";
import type { ActionState } from "@/components/app/action-form";
import { SESSION_COOKIE, sessionCookieOptions, requestMeta } from "@/lib/auth/session";
import { localLogin, localLogout, localVerifyMfa, localCreateReset, localConsumeReset } from "@/lib/auth/local";
import { supabaseServer } from "@/lib/auth/supabase";
import { passwordPolicyErrors } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rate-limit";

const safeNext = (n: unknown) => (typeof n === "string" && /^\/[a-zA-Z0-9/_\-?=&.]*$/.test(n) && !n.startsWith("//") ? n : "/dashboard");

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { ip, ua } = await requestMeta();
  const rl = rateLimit(`login:${ip ?? "unknown"}`, 10, 60_000);
  if (!rl.ok) return { error: `Too many attempts. Try again in ${rl.retryAfterSec} seconds.` };
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Enter your email address and password." };
  const next = safeNext(fd.get("next"));
  if (env().AUTH_PROVIDER === "supabase") {
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signInWithPassword(parsed.data);
    await serviceSql()`insert into public.login_events (user_id, email, event, ip, user_agent)
      values (${data.user?.id ?? null}, ${parsed.data.email}, ${error ? "login_failure" : "login_success"}, ${ip}, ${ua})`;
    if (error) return { error: "Invalid email or password." };
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    redirect(aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
  }
  const r = await localLogin(parsed.data.email, parsed.data.password, ip, ua);
  if (!r.ok) return { error: r.error };
  (await cookies()).set(SESSION_COOKIE, r.token, await sessionCookieOptions());
  redirect(r.mfaRequired ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
}

export async function mfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  const next = safeNext(fd.get("next"));
  const { ip } = await requestMeta();
  if (!rateLimit(`mfa:${ip}`, 10, 60_000).ok) return { error: "Too many attempts. Wait a minute and try again." };
  if (env().AUTH_PROVIDER === "supabase") {
    const sb = await supabaseServer();
    const { data: factors } = await sb.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (!totp) return { error: "No authenticator is enrolled for this account." };
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (error) return { error: "The code is not valid." };
    redirect(next);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await localVerifyMfa(token, code))) return { error: "The code is not valid." };
  redirect(next);
}

export async function logoutAction() {
  if (env().AUTH_PROVIDER === "supabase") {
    await (await supabaseServer()).auth.signOut();
  } else {
    const jar = await cookies();
    await localLogout(jar.get(SESSION_COOKIE)?.value);
    jar.delete(SESSION_COOKIE);
  }
  redirect("/login");
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const email = z.string().email().parse(fd.get("email"));
    const { ip } = await requestMeta();
    if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000).ok) return { error: "Too many requests. Try again later." };
    if (env().AUTH_PROVIDER === "supabase") {
      await (await supabaseServer()).auth.resetPasswordForEmail(email, { redirectTo: `${env().APP_URL}/auth/callback?next=/reset-password` });
    } else {
      const r = await localCreateReset(email);
      // Local provider has no mail transport: the link is written to the server log for the administrator.
      if (r) console.info(`[password-reset] ${email}: ${env().APP_URL}/reset-password?token=${r.token}`);
    }
    return { ok: true, message: "If the address is registered, password reset instructions have been issued. Contact your administrator if you do not receive them." };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const password = String(fd.get("password") ?? "");
    if (password !== String(fd.get("confirm") ?? "")) return { error: "Passwords do not match." };
    const errs = passwordPolicyErrors(password);
    if (errs.length) return { error: `Password must contain ${errs.join(", ")}.` };
    if (env().AUTH_PROVIDER === "supabase") {
      const { error } = await (await supabaseServer()).auth.updateUser({ password });
      if (error) return { error: error.message };
    } else {
      const ok = await localConsumeReset(String(fd.get("token") ?? ""), password);
      if (!ok) return { error: "This reset link is invalid or has expired." };
    }
    redirect("/login?reset=1");
  });
}
