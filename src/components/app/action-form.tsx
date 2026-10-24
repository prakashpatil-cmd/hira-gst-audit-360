"use client";
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ActionState { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> }
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pendingText, ...p }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || p.disabled} {...p}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** A form bound to a server action that shows the action's error/success message inline. */
export function ActionForm({ action, children, className, submitLabel, submitVariant, pendingText, resetOnSuccess, inline, confirm }: {
  action: ServerAction; children?: React.ReactNode; className?: string; submitLabel?: string; submitVariant?: ButtonProps["variant"];
  pendingText?: string; resetOnSuccess?: boolean; inline?: boolean; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => { if (state.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={cn(inline ? "inline-flex items-center gap-2" : "space-y-4", className)}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {submitLabel ? <SubmitButton variant={submitVariant} size={inline ? "sm" : "default"} pendingText={pendingText}>{submitLabel}</SubmitButton> : null}
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok && state.message ? <p role="status" className="text-sm text-primary">{state.message}</p> : null}
    </form>
  );
}
