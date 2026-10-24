import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { inr } from "@/lib/gst/money";
import { fmtPeriod } from "@/lib/gst/dates";
import { PageHeader, Section, Stat } from "@/components/app/page-header";
import { BarsChart, CountBars, Donut, RISK_COLORS } from "@/components/app/charts";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Firm dashboard" };
const REPORTED = "('approved','shared_with_client','client_responded','final','resolved')";

export default async function Dashboard() {
  const user = await requireUser();
  const d = await withUser(user.id, async (tx) => {
    const [k] = await tx`select
        (select count(*)::int from public.clients) clients,
        (select count(*)::int from public.audit_engagements where status <> 'closed') active,
        (select count(distinct eg.client_gstin_id)::int from public.engagement_gstins eg join public.audit_engagements e on e.id = eg.engagement_id where e.status <> 'closed') gstins,
        (select count(*)::int from public.audit_observations) findings,
        (select count(*)::int from public.audit_observations where risk_grade = 'critical' and status not in ('resolved','closed')) critical,
        (select count(*)::int from public.audit_observations where risk_grade = 'high' and status not in ('resolved','closed')) high,
        (select coalesce(sum(tax_amount),0)::text from public.audit_observations where status in ${tx.unsafe(REPORTED)}) tax,
        (select coalesce(sum(interest_amount),0)::text from public.audit_observations where status in ${tx.unsafe(REPORTED)}) interest,
        (select coalesce(sum(recoverable_amount),0)::text from public.audit_observations where status in ${tx.unsafe(REPORTED)}) recoverable,
        (select coalesce(sum(contingent_amount),0)::text from public.audit_observations where status in ${tx.unsafe(REPORTED)}) contingent,
        (select coalesce(sum(abs(x.diff_tax)),0)::text from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
           where r.is_current and x.severity = 'opportunity' and x.status in ('open','under_investigation')) opportunities,
        (select count(*)::int from public.document_requests where status in ('requested','rejected')) pending_docs,
        (select count(*)::int from public.corrective_actions where status in ('open','in_progress') and due_date < current_date) overdue_actions,
        (select count(*)::int from public.report_versions where status = 'pending_approval') reports_pending,
        (select count(*)::int from public.audit_observations where status = 'pending_review') obs_pending`;
    const completion = await tx`select e.id, e.engagement_code, c.legal_name,
        count(t.*) filter (where t.status <> 'not_applicable')::int applicable,
        count(t.*) filter (where t.status in ('passed','exception_detected','confirmed_observation','resolved','closed') and (coalesce(length(t.work_performed),0) > 0 or cardinality(t.evidence_document_ids) > 0))::int tested
      from public.audit_engagements e join public.clients c on c.id = e.client_id left join public.audit_test_results t on t.engagement_id = e.id
      where e.status <> 'closed' group by e.id, c.legal_name order by e.engagement_code`;
    const riskByCat = await tx`select category, risk_grade, count(*)::int n from public.audit_observations where status not in ('closed') group by 1, 2`;
    const byGstin = await tx`select coalesce(g.gstin, 'Entity') gstin, sum(o.tax_amount)::float tax from public.audit_observations o left join public.client_gstins g on g.id = o.client_gstin_id
      where o.status in ${tx.unsafe(REPORTED)} group by 1 order by 2 desc nulls last limit 12`;
    const byFy = await tx`select e.financial_year fy, sum(o.tax_amount)::float tax, sum(o.recoverable_amount)::float rec from public.audit_observations o join public.audit_engagements e on e.id = o.engagement_id
      where o.status in ${tx.unsafe(REPORTED)} group by 1 order by 1`;
    const monthly = await tx`select m.period, sum(abs((m.diff->>'tax')::numeric))::float diff from public.reconciliation_matches m join public.reconciliation_runs r on r.id = m.run_id
      where r.is_current and r.recon_type in ('BOOKS_GSTR1','GSTR1_GSTR3B','PR_2B_3B') and m.period is not null and m.match_status not like 'matched%' group by 1 order by 1 limit 24`;
    const itcOpp = await tx`select c.legal_name, sum(abs(x.diff_tax))::float amt from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      join public.audit_engagements e on e.id = x.engagement_id join public.clients c on c.id = e.client_id
      where r.is_current and x.module = 'C' and x.severity = 'opportunity' and x.status in ('open','under_investigation') group by 1 order by 2 desc limit 10`;
    const team = await tx`select u.full_name, count(*)::int n from public.audit_test_results t join public.users u on u.id = t.tested_by group by 1 order by 2 desc limit 12`;
    const ageing = await tx`select case when now() - created_at < interval '30 days' then '0–30 days' when now() - created_at < interval '60 days' then '31–60 days'
        when now() - created_at < interval '90 days' then '61–90 days' else '90+ days' end bucket, count(*)::int n
      from public.audit_observations where status not in ('resolved','closed','final') group by 1`;
    const recurring = await tx`select c.legal_name, o.control_id, count(distinct o.engagement_id)::int engagements, max(o.title) title
      from public.audit_observations o join public.clients c on c.id = o.client_id where o.control_id is not null
      group by 1, 2 having count(distinct o.engagement_id) > 1 or bool_or(o.is_repeat) order by 3 desc limit 10`;
    return { k, completion, riskByCat, byGstin, byFy, monthly, itcOpp, team, ageing, recurring };
  });
  const k = d.k;
  const cats = Array.from(new Set(d.riskByCat.map((r) => r.category)));
  const riskData = cats.map((c) => ({ name: c, ...Object.fromEntries(["critical", "high", "medium", "low", "opportunity"].map((r) => [r, d.riskByCat.find((x) => x.category === c && x.risk_grade === r)?.n ?? 0])) }));
  const avg = d.completion.length ? Math.round(d.completion.reduce((s, c) => s + (c.applicable ? c.tested / c.applicable : 0), 0) / d.completion.length * 100) : 0;
  return (
    <>
      <PageHeader title="Firm dashboard" description={`Welcome, ${user.fullName}. Figures are limited to the engagements you can access and drill down to the underlying records.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Stat label="Clients" value={k.clients} href="/clients" />
        <Stat label="Active engagements" value={k.active} href="/engagements" />
        <Stat label="GSTINs under review" value={k.gstins} href="/engagements" />
        <Stat label="Audit completion (avg.)" value={`${avg}%`} sub="Controls adequately tested" href="/engagements" />
        <Stat label="Total findings" value={k.findings} href="/reports" />
        <Stat label="Critical open" value={k.critical} tone={k.critical ? "danger" : undefined} href="/engagements" />
        <Stat label="High-risk open" value={k.high} tone={k.high ? "danger" : undefined} href="/engagements" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Stat label="Quantified tax exposure" value={`₹${inr(k.tax, { decimals: 0 })}`} sub="Approved observations" tone="danger" href="/reports" />
        <Stat label="Interest exposure" value={`₹${inr(k.interest, { decimals: 0 })}`} sub="Indicative" />
        <Stat label="Credits & refunds" value={`₹${inr(Number(k.recoverable) + Number(k.opportunities), { decimals: 0 })}`} sub="Recoverable + open opportunities" tone="info" />
        <Stat label="Contingent" value={`₹${inr(k.contingent, { decimals: 0 })}`} sub="Not added to tax" />
        <Stat label="Pending documents" value={k.pending_docs} href="/engagements" />
        <Stat label="Overdue actions" value={k.overdue_actions} tone={k.overdue_actions ? "danger" : undefined} href="/actions?filter=overdue" />
        <Stat label="Reports awaiting approval" value={k.reports_pending} sub={`${k.obs_pending} observation(s) awaiting review`} href="/reports?status=pending_approval" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section title="Risk by category"><div className="p-4"><BarsChart data={riskData} stacked bars={["critical", "high", "medium", "low", "opportunity"].map((r) => ({ key: r, label: r, color: RISK_COLORS[r] }))} /></div></Section>
        <Section title="Tax exposure by GSTIN"><div className="p-4"><CountBars data={d.byGstin.map((g) => ({ name: g.gstin, value: Math.round(g.tax ?? 0) }))} /></div></Section>
        <Section title="Tax exposure and recoveries by financial year"><div className="p-4"><BarsChart data={d.byFy.map((f) => ({ name: f.fy, tax: f.tax ?? 0, rec: f.rec ?? 0 }))} bars={[{ key: "tax", label: "Tax exposure", color: "#c0392b" }, { key: "rec", label: "Recoverable", color: "#1f6feb" }]} /></div></Section>
        <Section title="Monthly reconciliation differences (absolute tax)"><div className="p-4"><BarsChart data={d.monthly.map((m) => ({ name: fmtPeriod(m.period), diff: m.diff ?? 0 }))} bars={[{ key: "diff", label: "Unmatched tax difference" }]} /></div></Section>
        <Section title="ITC recovery opportunities by client"><div className="p-4"><CountBars data={d.itcOpp.map((x) => ({ name: x.legal_name, value: Math.round(x.amt ?? 0) }))} colorBy={{ x: "#1f6feb" }} /></div></Section>
        <Section title="Audit completion by team member (controls tested)"><div className="p-4"><CountBars data={d.team.map((t) => ({ name: t.full_name, value: t.n }))} /></div></Section>
        <Section title="Observation ageing (open)"><div className="p-4"><Donut data={["0–30 days", "31–60 days", "61–90 days", "90+ days"].map((b, i) => ({ name: b, value: d.ageing.find((a) => a.bucket === b)?.n ?? 0, color: ["#81bb41", "#d4a017", "#e67e22", "#c0392b"][i] }))} /></div></Section>
        <Section title="Recurring issues by client">
          <Table><THead><TR><TH>Client</TH><TH>Control</TH><TH>Issue</TH><TH className="text-right">Engagements</TH></TR></THead>
            <TBody>{d.recurring.length === 0 ? <Empty colSpan={4}>No recurring issues identified yet.</Empty> : d.recurring.map((r, i) => (
              <TR key={i}><TD>{r.legal_name}</TD><TD className="font-mono text-xs">{r.control_id}</TD><TD className="text-sm">{r.title}</TD><TD className="num">{r.engagements}</TD></TR>))}</TBody></Table>
        </Section>
      </div>
      <div className="mt-6">
        <Section title="Engagement completion">
          <Table><THead><TR><TH>Engagement</TH><TH>Client</TH><TH className="text-right">Applicable controls</TH><TH className="text-right">Tested</TH><TH>Coverage</TH></TR></THead>
            <TBody>{d.completion.length === 0 ? <Empty colSpan={5}>No active engagements.</Empty> : d.completion.map((c) => {
              const pct = c.applicable ? Math.round((c.tested / c.applicable) * 100) : 0;
              return <TR key={c.id}><TD><Link className="text-hira-800 hover:underline" href={`/engagements/${c.id}`}>{c.engagement_code}</Link></TD><TD>{c.legal_name}</TD>
                <TD className="num">{c.applicable}</TD><TD className="num">{c.tested}</TD>
                <TD className="w-64"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} /></div><span className="text-xs">{pct}%</span></div></TD></TR>;
            })}</TBody></Table>
        </Section>
      </div>
      <p className="mt-4 text-xs text-muted-foreground"><StatusBadge status="approved" /> Exposure figures include only approved observations. Penalties are never added to exposure totals.</p>
    </>
  );
}
