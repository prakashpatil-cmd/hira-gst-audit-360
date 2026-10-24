"use client";
import { useState, useTransition } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { startMfaEnrolment, confirmMfaAction } from "./actions";

export function MfaEnrol() {
  const [data, setData] = useState<{ qr: string; secret: string; factorId?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!data) return (
    <div className="space-y-2">
      <Button onClick={() => start(async () => { try { setData(await startMfaEnrolment()); } catch (e) { setErr(String((e as Error).message)); } })} disabled={pending}>Set up authenticator app</Button>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  );
  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.qr} alt="Scan with your authenticator app" className="h-48 w-48 rounded border bg-white p-2" />
      <p className="text-xs text-muted-foreground">Or enter this key manually: <span className="font-mono">{data.secret}</span></p>
      <ActionForm action={confirmMfaAction} submitLabel="Confirm">
        {data.factorId ? <input type="hidden" name="factor_id" value={data.factorId} /> : null}
        <Field label="6-digit code from the app"><Input name="code" inputMode="numeric" required className="w-40" /></Field>
      </ActionForm>
    </div>
  );
}
