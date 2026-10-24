import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { inr } from "@/lib/gst/money";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { ActionsTable } from "@/components/app/actions-table";
import { Input, Textarea } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge, StatusBadge } from "@/components/ui/badge";
import { updateRequestAction } from "@/app/(app)/engagements/[id]/work-actions";
import { responseAction } from "@/app/(app)/engagements/[id]/observations/actions";

export const metadata = { title: "Client portal" };

/** Client users see only their own organisation (enforced by RLS) and only material released to them. */
export default async function Portal() {
  const user = await requireUser({ allowClient: true });
  const d = await withUser(user.id, async (tx) => ({
    engagements: await tx`select e.id, e.engagement_code, e.title, e.period_from, e.period_to, c.legal_name from public.audit_engagements e join public.clients c on c.id = e.client_id order by e.period_to desc`,
    requests: await tx`select * from public.document_requests where status in ('requested','rejected','uploaded') order by due_date nulls last, title`,
    observations: await tx`select o.*, (select json_agg(json_build_object('text', r.response_text, 'status', r.status, 'date', r.response_date)) from public.management_responses r where r.observation_id = o.id) responses
      from public.audit_observations o order by o.engagement_id, o.obs_number`,
    actions: await tx`select a.*, o.obs_number from public.corrective_actions a left join public.audit_observations o on o.id = a.observation_id order by a.due_date nulls last`,
    reports: await tx`select r.version, r.label, r.approved_at, r.pdf_document_id, r.xlsx_document_id, e.engagement_code from public.report_versions r join public.audit_engagements e on e.id = r.engagement_id
      where r.status = 'issued' order by r.approved_at desc`,
  }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-hira-800">{d.engagements[0]?.legal_name ?? "Your organisation"}</h1>
        <p className="text-sm text-muted-foreground">{d.engagements.map((e) => `${e.engagement_code} (${fmtDate(e.period_from)} – ${fmtDate(e.period_to)})`).join(" · ") || "No engagements yet."}</p></div>
      <Section title="Information requested by the audit team" description="Upload the requested records. Files are stored privately and are visible only to the audit team.">
        <Table><THead><TR><TH>Item</TH><TH>Due</TH><TH>Status</TH><TH>Upload</TH></TR></THead>
          <TBody>{d.requests.length === 0 ? <Empty colSpan={4}>Nothing outstanding.</Empty> : d.requests.map((r) => (
            <TR key={r.id}><TD><div className="font-medium">{r.title}</div>{r.review_comment ? <div className="text-xs text-amber-700">Auditor: {r.review_comment}</div> : null}</TD>
              <TD className={r.due_date && r.due_date < today ? "font-medium text-red-700" : ""}>{fmtDate(r.due_date)}</TD><TD><StatusBadge status={r.status} /></TD>
              <TD><ActionForm action={updateRequestAction} inline><input type="hidden" name="id" value={r.id} /><input type="hidden" name="engagement_id" value={r.engagement_id} />
                <input type="hidden" name="op" value="upload" /><Input type="file" name="file" className="h-8 w-56 text-xs" /><button className="rounded border px-2 py-1 text-xs hover:bg-muted">Upload</button></ActionForm></TD></TR>))}</TBody></Table>
      </Section>
      <Section title="Observations shared for your response">
        <div className="divide-y">{d.observations.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No observations have been shared yet.</p> : d.observations.map((o) => (
          <div key={o.id} className="space-y-2 p-5">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-hira-800">Observation {o.obs_number}: {o.title}</span><RiskBadge risk={o.risk_grade} /><StatusBadge status={o.status} /></div>
            <p className="text-xs text-muted-foreground">Category {o.category} · Indicative impact {Number(o.tax_amount) ? `₹${inr(o.tax_amount, { decimals: 0 })}` : o.impact_text ?? "To be quantified"}</p>
            <p className="whitespace-pre-line text-sm">{o.observation_text}</p>
            <details className="text-sm"><summary className="cursor-pointer text-primary">Legal framework and action required</summary>
              <p className="mt-2 whitespace-pre-line text-xs">{o.legal_framework}</p><p className="mt-2 whitespace-pre-line">{o.action_required}</p></details>
            {(o.responses ?? []).map((r: { text: string; status: string; date: string }, i: number) => <p key={i} className="rounded bg-muted p-2 text-xs">Your response ({fmtDate(r.date)}, {r.status.replace(/_/g, " ")}): {r.text}</p>)}
            {["shared_with_client", "client_responded"].includes(o.status) ? (
              <ActionForm action={responseAction} submitLabel="Submit response" resetOnSuccess>
                <input type="hidden" name="observation_id" value={o.id} /><input type="hidden" name="engagement_id" value={o.engagement_id} /><input type="hidden" name="op" value="add" />
                <Textarea name="response_text" rows={2} placeholder="Management response and corrective action planned" />
              </ActionForm>) : null}
          </div>))}</div>
      </Section>
      <Section title="Corrective actions assigned"><ActionsTable rows={d.actions} portal /></Section>
      <Section title="Issued reports">
        <Table><THead><TR><TH>Engagement</TH><TH>Version</TH><TH>Issued</TH><TH>Files</TH></TR></THead>
          <TBody>{d.reports.length === 0 ? <Empty colSpan={4}>No reports issued yet.</Empty> : d.reports.map((r, i) => (
            <TR key={i}><TD>{r.engagement_code}</TD><TD>v{r.version} {r.label}</TD><TD>{fmtDate(r.approved_at)}</TD>
              <TD><a className="mr-3 text-primary hover:underline" href={`/api/files/${r.pdf_document_id}`}>PDF</a>{r.xlsx_document_id ? <a className="text-primary hover:underline" href={`/api/files/${r.xlsx_document_id}`}>Annexures</a> : null}</TD></TR>))}</TBody></Table>
      </Section>
    </div>
  );
}
