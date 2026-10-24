import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { RECON_TYPES } from "@/lib/recon/runner";
import { fmtDateTime, fmtPeriod, todayIso } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { JobWatcher } from "@/components/app/job-watcher";
import { BarsChart } from "@/components/app/charts";
import { Field, Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { runReconAction } from "./actions";

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { runs, jobs, monthly } = await withUser(user.id, async (tx) => ({
    runs: await tx`select distinct on (recon_type) r.*, u.full_name,
        (select count(*)::int from public.reconciliation_exceptions x where x.run_id = r.id) exceptions,
        (select count(*)::int from public.reconciliation_exceptions x where x.run_id = r.id and x.status in ('open','under_investigation')) open_ex
      from public.reconciliation_runs r left join public.users u on u.id = r.created_by
      where r.engagement_id = ${id} order by recon_type, created_at desc`,
    jobs: await tx`select id from public.jobs where engagement_id = ${id} and job_type = 'recon.run' and status in ('queued','running')`,
    monthly: await tx`select m.period, sum((m.left_values->>'tax')::numeric)::float g1, sum((m.right_values->>'tax')::numeric)::float g3b
      from public.reconciliation_matches m join public.reconciliation_runs r on r.id = m.run_id
      where r.engagement_id = ${id} and r.is_current and r.recon_type = 'GSTR1_GSTR3B' and m.period is not null group by m.period order by m.period`,
  }));
  const byType = new Map(runs.map((r) => [r.recon_type, r]));
  const canRun = can(user, "recon.run");
  return (
    <div className="space-y-6">
      {jobs.map((j) => <JobWatcher key={j.id} jobId={j.id} label="Reconciliation" />)}
      {canRun ? (
        <Section title="Run reconciliations" description="Runs use all committed data for the engagement. Identical inputs produce identical results (input hash recorded). Triage decisions carry forward to re-runs.">
          <ActionForm action={runReconAction} submitLabel="Run all reconciliations" pendingText="Running…" className="flex flex-wrap items-end gap-4 p-5">
            <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="recon_type" value="ALL" />
            <Field label="Compute time limits and interest as at"><Input type="date" name="as_of" defaultValue={todayIso()} /></Field>
            <Field label="Tolerance override (₹, optional)"><Input name="tolerance" placeholder="engagement default" className="w-40" /></Field>
          </ActionForm>
        </Section>
      ) : null}
      <Section title="Reconciliations">
        <Table>
          <THead><TR><TH>Reconciliation</TH><TH>Last run</TH><TH>Matched</TH><TH>Differences</TH><TH className="text-right">Exceptions</TH><TH className="text-right">Open</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>{Object.entries(RECON_TYPES).map(([k, v]) => {
            const r = byType.get(k);
            const mc = (r?.summary?.matchCounts ?? {}) as Record<string, number>;
            const matched = (mc.matched ?? 0) + (mc.matched_tolerance ?? 0) + (mc.matched_fuzzy ?? 0);
            const diffs = Object.entries(mc).filter(([s]) => !s.startsWith("matched")).reduce((a, [, n]) => a + n, 0);
            return (
              <TR key={k}>
                <TD><div className="font-medium">{v.label}</div><div className="text-xs text-muted-foreground">Module {v.module}{v.needs.length ? ` · needs ${v.needs.join(", ")}` : ""}</div></TD>
                <TD className="text-xs">{r ? <>{fmtDateTime(r.completed_at ?? r.created_at)}<div className="text-muted-foreground">{r.full_name} · engine {r.engine_version}</div></> : "Never run"}</TD>
                <TD className="num">{r ? matched : "—"}</TD><TD className="num">{r ? diffs : "—"}</TD>
                <TD className="num">{r?.exceptions ?? "—"}</TD><TD className="num">{r?.open_ex ?? "—"}</TD>
                <TD>{r ? <StatusBadge status={r.status} /> : null}{r?.error ? <div className="max-w-xs text-xs text-red-700">{r.error}</div> : null}</TD>
                <TD className="whitespace-nowrap text-right">
                  {r ? <Link className="mr-3 text-sm text-primary hover:underline" href={`/engagements/${id}/reconciliation/${r.id}`}>Results</Link> : null}
                  {canRun ? <ActionForm action={runReconAction} inline submitLabel="Run" submitVariant="outline"><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="recon_type" value={k} /></ActionForm> : null}
                </TD>
              </TR>
            );
          })}</TBody>
        </Table>
      </Section>
      <Section title="Monthly outward tax — GSTR-1 vs GSTR-3B">
        <div className="p-4"><BarsChart data={monthly.map((m) => ({ name: fmtPeriod(m.period), g1: m.g1 ?? 0, g3b: m.g3b ?? 0 }))}
          bars={[{ key: "g1", label: "GSTR-1 tax" }, { key: "g3b", label: "GSTR-3B tax", color: "#878787" }]} /></div>
      </Section>
    </div>
  );
}
