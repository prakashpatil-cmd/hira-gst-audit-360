"use client";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Select } from "@/components/ui/input";
import { aiAssist, applyAiDraft } from "./ai-actions";

const TASKS: [string, string][] = [["explain", "Explain the exception"], ["verify", "Suggest verification steps"], ["draft", "Draft observation text"],
  ["action", "Draft corrective action"], ["risks", "Summarise financial risks"], ["clarification", "Client clarification request"],
  ["management", "Management-level explanation"], ["legal", "Identify possibly relevant provisions"]];

export function AiPanel({ observationId, engagementId }: { observationId: string; engagementId: string }) {
  const [task, setTask] = useState("explain");
  const [out, setOut] = useState<{ text?: string; error?: string; model?: string } | null>(null);
  const [pending, start] = useTransition();
  const [field, setField] = useState("observation_text");
  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-5 py-3"><Sparkles className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-hira-800">HIRA GST Intelligence</h2></div>
      <div className="space-y-3 p-5 text-sm">
        <p className="text-xs text-muted-foreground">Drafting help from case facts only. Figures come from the calculation engine; unverified law is flagged. Anything inserted is marked as an AI draft and must be approved by a reviewer.</p>
        <div className="flex gap-2">
          <Select value={task} onChange={(e) => setTask(e.target.value)} className="h-8 text-xs">{TASKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <button disabled={pending} onClick={() => start(async () => setOut(await aiAssist(observationId, engagementId, task)))}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-white disabled:opacity-50">{pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Ask</button>
        </div>
        {out?.error ? <p className="text-xs text-amber-700">{out.error}</p> : null}
        {out?.text ? (
          <div className="space-y-2">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs">{out.text}</pre>
            <p className="text-[10px] text-muted-foreground">Model: {out.model}</p>
            <div className="flex gap-2">
              <Select value={field} onChange={(e) => setField(e.target.value)} className="h-8 text-xs">
                <option value="observation_text">A. Observation</option><option value="financial_implication">C. Financial implication</option>
                <option value="root_cause">D. Root cause</option><option value="action_required">E. Action required</option><option value="preventive_control">F. Preventive control</option></Select>
              <button onClick={() => start(async () => { const r = await applyAiDraft(observationId, engagementId, field, out.text!); if (!r.ok) setOut({ ...out, error: r.error }); })}
                className="rounded-md border px-3 text-xs hover:bg-muted">Insert as draft</button>
            </div>
          </div>) : null}
      </div>
    </section>
  );
}
