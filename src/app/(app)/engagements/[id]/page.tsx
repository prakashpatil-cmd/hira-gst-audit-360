import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getEngagement } from "@/lib/queries";
import { engagementCoverage } from "@/lib/coverage";
import { STAGES } from "@/lib/engagements";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtDateTime } from "@/lib/gst/dates";
import { Stat, Section } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default async function EngagementOverview({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await getEngagement(user, id);
  const d = await withUser(user.id, async (tx) => {
    const cov = await engagementCoverage(tx, id);
    const [ex] = await tx<{ open: number; critical: number; high: number; tax: string }[]>`
      select count(*) filter (where x.status in ('open','under_investigation'))::int open,
             count(*) filter (where x.severity = 'critical' and x.status in ('open','under_investigation'))::int critical,
             count(*) filter (where x.severity = 'high' and x.status in ('open','under_investigation'))::int high,
             coalesce(sum(x.diff_tax) filter (where x.status in ('open','under_investigation') and x.severity in ('critical','high','medium') and x.diff_tax > 0), 0)::text tax
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id where x.engagement_id = ${id} and r.is_current`;
    const top = await tx`select id, obs_number, title, risk_grade, tax_amount, impact_text, status from public.audit_observations where engagement_id = ${id}
      order by case risk_grade when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'opportunity' then 3 else 4 end, tax_amount desc limit 5`;
    const activity = await tx`select l.action, l.entity_type, l.created_at, u.full_name from public.audit_logs l left join public.users u on u.id = l.actor_id
      where l.engagement_id = ${id} order by l.id desc limit 8`.catch(() => []);
    return { cov, ex, top, activity };
  });
  const stageIdx = STAGES.findIndex((s) => s.key === e.status);
  const c = d.cov;
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-5">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {STAGES.slice(0, 8).map((s, i) => (
              <li key={s.key} className={cn("rounded-md border px-3 py-2 text-xs", i < stageIdx ? "border-hira-300 bg-hira-50 text-hira-800" : i === stageIdx ? "border-primary bg-primary text-white" : "text-muted-foreground")}>
                <span className="block font-semibold">Stage {s.n}</span>{s.label}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Audit coverage" value={`${c.coveragePct}%`} sub={`${c.tested} of ${c.applicable} applicable controls adequately tested`} href={`/engagements/${id}/checklist`} />
        <Stat label="Compliance exception rate" value={`${c.exceptionRatePct}%`} sub={`${c.failed} tested control(s) with exceptions`} href={`/engagements/${id}/checklist?status=exception_detected`} tone={c.failed ? "danger" : undefined} />
        <Stat label="Evidence completeness" value={`${c.evidence.pct}%`} sub={`${c.evidence.accepted} of ${c.evidence.required} requested records accepted`} href={`/engagements/${id}/requests`} />
        <Stat label="Outstanding risk" value={c.outstanding.count} sub={`High/critical observations open · ₹${inr(c.outstanding.tax, { decimals: 0 })}`} href={`/engagements/${id}/observations`} tone={c.outstanding.count ? "danger" : "good"} />
        <Stat label="Open exceptions" value={d.ex.open} sub={`${d.ex.critical} critical · ${d.ex.high} high`} href={`/engagements/${id}/exceptions`} />
        <Stat label="Open exception tax (indicative)" value={`₹${inr(d.ex.tax, { decimals: 0 })}`} sub="Positive differences, before investigation" href={`/engagements/${id}/exceptions`} />
        <Stat label="Observations" value={c.observations.total} sub={`${c.observations.reviewed} reviewed · ${c.observations.unreviewed} unreviewed`} href={`/engagements/${id}/observations`} />
        <Stat label="Controls awaiting documents" value={c.awaiting} sub={`${c.notApplicable} not applicable · ${c.notStarted} not started`} href={`/engagements/${id}/checklist?status=data_awaited`} />
      </div>

      <Card>
        <CardHeader><CardTitle>Coverage conclusion</CardTitle></CardHeader>
        <CardContent><p className="text-sm">{c.conclusion}</p>
          {c.testedWithoutWork ? <p className="mt-2 text-xs text-amber-700">{c.testedWithoutWork} control(s) carry a tested status without recorded work or evidence and are counted as not tested.</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">The application does not issue a "100% GST compliant" certificate; conclusions are limited to the controls tested and the records received.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Top observations">
          <Table><THead><TR><TH>No.</TH><TH>Observation</TH><TH className="text-right">Tax impact</TH><TH>Risk</TH></TR></THead>
            <TBody>{d.top.length === 0 ? <Empty colSpan={4}>No observations drafted yet.</Empty> : d.top.map((o) => (
              <TR key={o.id}><TD>{o.obs_number}</TD><TD><Link href={`/engagements/${id}/observations/${o.id}`} className="text-hira-800 hover:underline">{o.title}</Link></TD>
                <TD className="num">{Number(o.tax_amount) ? `₹${inr(o.tax_amount, { decimals: 0 })}` : o.impact_text ?? "To be quantified"}</TD><TD><RiskBadge risk={o.risk_grade} /></TD></TR>))}
            </TBody></Table>
        </Section>
        <Section title="Engagement details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-5 text-sm">
            <dt className="text-muted-foreground">Data requested</dt><dd>{fmtDate(e.data_request_date)}</dd>
            <dt className="text-muted-foreground">Completion deadline</dt><dd>{fmtDate(e.completion_deadline)}</dd>
            <dt className="text-muted-foreground">Report issued</dt><dd>{fmtDate(e.report_issue_date)}</dd>
            <dt className="text-muted-foreground">Materiality</dt><dd>₹{inr(e.materiality_amount, { decimals: 0 })}</dd>
            <dt className="text-muted-foreground">Audit visits</dt><dd>{e.audit_visits.length ? e.audit_visits.map((v, i) => <div key={i}>{v.label}: {fmtDate(v.from)}{v.to && v.to !== v.from ? ` – ${fmtDate(v.to)}` : ""}</div>) : "—"}</dd>
            <dt className="text-muted-foreground">GSTINs</dt><dd className="font-mono text-xs">{e.gstins.map((g) => <div key={g.id}>{g.gstin}</div>)}</dd>
          </dl>
          <div className="border-t px-5 py-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recent activity</p>
            {d.activity.length === 0 ? <p className="text-xs text-muted-foreground">Activity is visible to administrators in the audit log.</p> :
              <ul className="space-y-1 text-xs">{d.activity.map((a, i) => <li key={i}>{fmtDateTime(a.created_at)} — {a.full_name ?? "System"} {a.action} {a.entity_type.replace(/_/g, " ")}</li>)}</ul>}
          </div>
        </Section>
      </div>
    </div>
  );
}
