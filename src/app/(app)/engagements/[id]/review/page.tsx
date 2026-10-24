import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { inr } from "@/lib/gst/money";
import { fmtDateTime } from "@/lib/gst/dates";
import { Section, Stat } from "@/components/app/page-header";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge, StatusBadge } from "@/components/ui/badge";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const d = await withUser(user.id, async (tx) => ({
    pending: await tx`select o.id, o.obs_number, o.title, o.risk_grade, o.tax_amount, o.status, o.updated_at, u.full_name preparer, o.ai_generated, o.ai_approved_by
      from public.audit_observations o left join public.users u on u.id = o.created_by where o.engagement_id = ${id} and o.status in ('pending_review','changes_requested','client_responded')
      order by o.status, o.obs_number`,
    signoff: await tx`select t.control_id, ac.title, t.status, u.full_name tester, t.tested_at from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id
      left join public.users u on u.id = t.tested_by where t.engagement_id = ${id} and t.tested_at is not null and t.reviewed_at is null and t.status <> 'not_applicable' order by t.control_id`,
    responses: await tx`select r.id, r.response_text, r.responder_name, o.id oid, o.obs_number from public.management_responses r join public.audit_observations o on o.id = r.observation_id
      where r.engagement_id = ${id} and r.status = 'submitted'`,
    history: await tx`select a.*, u.full_name, o.obs_number from public.review_approvals a join public.users u on u.id = a.actor_id
      left join public.audit_observations o on o.id = a.entity_id where a.engagement_id = ${id} order by a.created_at desc limit 30`,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Observations awaiting review" value={d.pending.filter((p) => p.status === "pending_review").length} tone="danger" />
        <Stat label="Tested controls awaiting sign-off" value={d.signoff.length} />
        <Stat label="Client responses to review" value={d.responses.length} />
      </div>
      <Section title="Review queue" description="The preparer cannot approve their own observation. Approval requires the legal framework, action required and a calculation snapshot for quantified amounts.">
        <Table><THead><TR><TH>No.</TH><TH>Observation</TH><TH>Prepared by</TH><TH className="text-right">Tax</TH><TH>Risk</TH><TH>Status</TH></TR></THead>
          <TBody>{d.pending.length === 0 ? <Empty colSpan={6}>Nothing awaiting review.</Empty> : d.pending.map((o) => (
            <TR key={o.id}><TD>{o.obs_number}</TD><TD><Link className="text-hira-800 hover:underline" href={`/engagements/${id}/observations/${o.id}`}>{o.title}</Link>
              {o.ai_generated && !o.ai_approved_by ? <div className="text-xs text-red-700">Contains AI-drafted text — approval confirms human review</div> : null}</TD>
              <TD className="text-xs">{o.preparer}<div className="text-muted-foreground">{fmtDateTime(o.updated_at)}</div></TD><TD className="num">₹{inr(o.tax_amount, { decimals: 0 })}</TD>
              <TD><RiskBadge risk={o.risk_grade} /></TD><TD><StatusBadge status={o.status} /></TD></TR>))}</TBody></Table>
      </Section>
      <Section title="Controls awaiting reviewer sign-off">
        <Table><THead><TR><TH>Control</TH><TH>Title</TH><TH>Tested by</TH><TH>Status</TH></TR></THead>
          <TBody>{d.signoff.length === 0 ? <Empty colSpan={4}>None.</Empty> : d.signoff.map((c) => (
            <TR key={c.control_id}><TD><Link className="font-mono text-xs text-primary hover:underline" href={`/engagements/${id}/checklist/${c.control_id}`}>{c.control_id}</Link></TD><TD>{c.title}</TD>
              <TD className="text-xs">{c.tester} · {fmtDateTime(c.tested_at)}</TD><TD><StatusBadge status={c.status} /></TD></TR>))}</TBody></Table>
      </Section>
      <Section title="Client responses awaiting approval">
        <Table><THead><TR><TH>Obs.</TH><TH>Response</TH><TH>From</TH></TR></THead>
          <TBody>{d.responses.length === 0 ? <Empty colSpan={3}>None.</Empty> : d.responses.map((r) => (
            <TR key={r.id}><TD><Link className="text-primary hover:underline" href={`/engagements/${id}/observations/${r.oid}`}>{r.obs_number}</Link></TD><TD className="max-w-xl text-sm">{r.response_text}</TD><TD>{r.responder_name}</TD></TR>))}</TBody></Table>
      </Section>
      <Section title="Review trail">
        <ul className="space-y-1 p-5 text-xs">{d.history.length === 0 ? <li className="text-muted-foreground">No review activity yet.</li> : d.history.map((h) => (
          <li key={h.id}>{fmtDateTime(h.created_at)} — <b>{h.full_name}</b> {h.action.replace(/_/g, " ")} {h.entity_type.replace(/_/g, " ")}{h.obs_number ? ` ${h.obs_number}` : ""}{h.comment ? `: ${h.comment}` : ""}</li>))}</ul>
      </Section>
    </div>
  );
}
