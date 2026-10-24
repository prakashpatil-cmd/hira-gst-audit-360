"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import QRCode from "qrcode";
import { env } from "@/lib/env";
import { serviceSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { run } from "@/lib/actions";
import { newTotpSecret, verifyTotp, verifyPassword, passwordPolicyErrors } from "@/lib/auth/password";
import { localSetPassword } from "@/lib/auth/local";
import { supabaseServer } from "@/lib/auth/supabase";
import type { ActionState } from "@/components/app/action-form";

async function me() {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not signed in");
  return u;
}

export async function startMfaEnrolment(): Promise<{ qr: string; secret: string; factorId?: string }> {
  const u = await me();
  if (env().AUTH_PROVIDER === "supabase") {
    const { data, error } = await (await supabaseServer()).auth.mfa.enroll({ factorType: "totp", friendlyName: "HIRA GST Audit 360" });
    if (error || !data) throw new Error(error?.message ?? "Enrolment failed");
    return { qr: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
  }
  const secret = newTotpSecret();
  await serviceSql()`update local_auth.credentials set pending_totp_secret = ${secret} where user_id = ${u.id}`;
  const uri = `otpauth://totp/${encodeURIComponent("HIRA GST Audit 360")}:${encodeURIComponent(u.email)}?secret=${secret}&issuer=${encodeURIComponent("HIRA Associates")}&digits=6&period=30`;
  return { qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }), secret };
}

export async function confirmMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const code = String(fd.get("code") ?? "");
    if (env().AUTH_PROVIDER === "supabase") {
      const factorId = z.string().parse(fd.get("factor_id"));
      const { error } = await (await supabaseServer()).auth.mfa.challengeAndVerify({ factorId, code });
      if (error) return { error: "The code is not valid." };
    } else {
      const [c] = await serviceSql()<{ pending_totp_secret: string | null }[]>`select pending_totp_secret from local_auth.credentials where user_id = ${u.id}`;
      if (!c?.pending_totp_secret || !verifyTotp(c.pending_totp_secret, code)) return { error: "The code is not valid. Check the time on your phone and try again." };
      await serviceSql()`update local_auth.credentials set totp_secret = pending_totp_secret, pending_totp_secret = null where user_id = ${u.id}`;
      await serviceSql()`update local_auth.sessions set mfa_verified = true where user_id = ${u.id}`;
    }
    await serviceSql()`insert into public.login_events (user_id, event) values (${u.id}, 'mfa_success')`;
    revalidatePath("/account/security");
    return { ok: true, message: "Two-step verification is now active on your account." };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const u = await me();
    const current = String(fd.get("current") ?? ""), next = String(fd.get("password") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) return { error: "New passwords do not match." };
    const errs = passwordPolicyErrors(next);
    if (errs.length) return { error: `Password must contain ${errs.join(", ")}.` };
    if (env().AUTH_PROVIDER === "supabase") {
      const sb = await supabaseServer();
      const { error: e1 } = await sb.auth.signInWithPassword({ email: u.email, password: current });
      if (e1) return { error: "Current password is incorrect." };
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) return { error: error.message };
      return { ok: true, message: "Password changed." };
    }
    const [c] = await serviceSql()<{ password_hash: string }[]>`select password_hash from local_auth.credentials where user_id = ${u.id}`;
    if (!c || !(await verifyPassword(current, c.password_hash))) return { error: "Current password is incorrect." };
    await localSetPassword(u.id, next);
    return { ok: true, message: "Password changed. Other sessions have been signed out; sign in again." };
  });
}
