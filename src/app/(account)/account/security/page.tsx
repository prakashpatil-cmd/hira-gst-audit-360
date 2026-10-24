import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { serviceSql } from "@/lib/db";
import { fmtDateTime } from "@/lib/gst/dates";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MfaEnrol } from "./mfa";
import { changePasswordAction } from "./actions";

export const metadata = { title: "Account security" };

/** Reachable before MFA is complete (enforced enrolment lands here), so it uses getCurrentUser directly. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ enrol?: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const sp = await searchParams;
  const events = await serviceSql()`select event, ip, created_at from public.login_events where user_id = ${u.id} order by id desc limit 10`;
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold text-hira-800">Account security</h1>
        <Link href={u.isClientUser ? "/portal" : "/dashboard"} className="text-sm text-primary hover:underline">Back</Link></div>
      {sp.enrol ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your administrator requires two-step verification. Set it up to continue.</p> : null}
      <Card><CardHeader><CardTitle>Two-step verification {u.mfaEnrolled ? <Badge variant="secondary">Active</Badge> : <Badge variant="medium">Not set up</Badge>}</CardTitle></CardHeader>
        <CardContent>{u.mfaEnrolled ? <p className="text-sm text-muted-foreground">An authenticator app is linked to your account. Ask an administrator to reset it if you lose your device.</p> : <MfaEnrol />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent>
        <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess>
          <Field label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password" hint="At least 10 characters with upper and lower case letters, a digit and a symbol."><Input name="password" type="password" autoComplete="new-password" required /></Field>
          <Field label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
        </ActionForm></CardContent></Card>
      <Card><CardHeader><CardTitle>Recent sign-in activity</CardTitle></CardHeader><CardContent>
        <ul className="space-y-1 text-sm">{events.map((e, i) => <li key={i}>{fmtDateTime(e.created_at)} — {e.event.replace(/_/g, " ")} {e.ip ? `from ${e.ip}` : ""}</li>)}</ul></CardContent></Card>
    </div>
  );
}
