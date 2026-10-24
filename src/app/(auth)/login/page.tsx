import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/input";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Sign in to HIRA GST Audit 360°</h2>
        <p className="text-sm text-muted-foreground">Use the credentials issued by your administrator.</p>
      </div>
      {sp.reset ? <p className="rounded-md bg-accent p-2 text-center text-sm text-accent-foreground">Password updated. Sign in with your new password.</p> : null}
      <ActionForm action={loginAction} submitLabel="Sign in" pendingText="Signing in…">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <p className="text-center text-sm"><Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link></p>
    </div>
  );
}
