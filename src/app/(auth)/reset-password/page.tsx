import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/input";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Set a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <h2 className="text-center text-xl font-semibold">Set a new password</h2>
      <ActionForm action={resetPasswordAction} submitLabel="Update password">
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <Field label="New password" hint="At least 10 characters with upper and lower case letters, a digit and a symbol.">
          <Input name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Confirm password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
      </ActionForm>
    </div>
  );
}
