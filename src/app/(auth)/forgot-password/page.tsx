import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/input";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Password recovery" };

export default function ForgotPage() {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Password recovery</h2>
        <p className="text-sm text-muted-foreground">We will issue a single-use reset link valid for 30 minutes.</p>
      </div>
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link">
        <Field label="Email"><Input name="email" type="email" required autoFocus /></Field>
      </ActionForm>
      <p className="text-center text-sm"><Link href="/login" className="text-primary hover:underline">Back to sign in</Link></p>
    </div>
  );
}
