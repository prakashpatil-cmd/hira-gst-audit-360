"use client";
import { useActionState, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { ActionState } from "./action-form";

interface Props {
  engagementId: string;
  gstins: { id: string; gstin: string; label: string | null }[];
  datasets: { type: string; label: string; group: string; perGstin: boolean }[];
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  prepare: (engagementId: string, fileName: string) => Promise<{ key: string; url: string; token: string } | null>;
  defaultDataset?: string;
}

/** Uploads straight to private object storage when available (large files), otherwise posts to the server. */
export function UploadForm({ engagementId, gstins, datasets, action, prepare, defaultDataset }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const [ds, setDs] = useState(defaultDataset ?? "sales_register");
  const def = datasets.find((d) => d.type === ds);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    if (!file || file.size === 0) { setErr("Choose a file."); return; }
    try {
      setBusy("Preparing upload…");
      const signed = await prepare(engagementId, file.name);
      if (signed) {
        setBusy(`Uploading ${(file.size / 1048576).toFixed(1)} MB to secure storage…`);
        const r = await fetch(signed.url, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "false" } });
        if (!r.ok) throw new Error(`Upload failed (${r.status})`);
        fd.delete("file");
        fd.set("stored_key", signed.key);
        fd.set("file_name", file.name);
      }
      setBusy("Reading file…");
      formAction(fd);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(null);
    }
  }
  const groups = ["accounting", "gst", "other"];
  return (
    <form ref={ref} onSubmit={onSubmit} className="grid gap-4 md:grid-cols-4">
      <input type="hidden" name="engagement_id" value={engagementId} />
      <Field label="Record type">
        <Select name="dataset_type" value={ds} onChange={(e) => setDs(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g === "gst" ? "GST returns & portal" : g === "accounting" ? "Accounting records" : "Other compliance records"}>
              {datasets.filter((d) => d.group === g).map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label={def?.perGstin ? "GSTIN" : "GSTIN (optional)"}>
        <Select name="client_gstin_id" defaultValue={gstins[0]?.id ?? ""} required={def?.perGstin}>
          {!def?.perGstin ? <option value="">Entity level (all registrations)</option> : null}
          {gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}{g.label ? ` — ${g.label}` : ""}</option>)}
        </Select>
      </Field>
      <Field label="File (.xlsx, .csv or portal .json)" className="md:col-span-2">
        <Input name="file" type="file" accept=".xlsx,.csv,.json,.txt" required />
      </Field>
      <div className="md:col-span-4 flex items-center gap-3">
        <Button type="submit" disabled={!!busy || pending}>{busy || pending ? <Loader2 className="animate-spin" /> : <Upload />}Upload and map</Button>
        {busy ? <span className="text-sm text-muted-foreground">{busy}</span> : null}
        {err || state.error ? <span role="alert" className="text-sm text-destructive">{err ?? state.error}</span> : null}
      </div>
    </form>
  );
}
