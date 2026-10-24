import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/input";
import { mfaAction } from "../../actions";

export const metadata = { title: "Verification code" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Two-step verification</h2>
        <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <ActionForm action={mfaAction} submitLabel="Verify">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Code"><Input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required autoFocus /></Field>
      </ActionForm>
    </div>
  );
}
