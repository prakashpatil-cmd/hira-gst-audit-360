import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDateTime } from "@/lib/gst/dates";
import type { ReportSnapshot } from "@/lib/reports/snapshot";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { JobWatcher } from "@/components/app/job-watcher";
import { ImpactTable } from "@/components/app/impact-table";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { createReportVersionAction, saveReportContentAction, reportWorkflowAction, regenerateAction } from "./actions";

const FIELDS: [keyof ReportSnapshot["content"], string, number][] = [
  ["managementIntro", "Management summary — opening paragraph", 4], ["recommendations", "What we recommend you do first (one item per line)", 6],
  ["bottomLine", "Bottom line", 4], ["background", "Engagement background and scope", 6], ["methodology", "Methodology and risk grading", 6],
  ["roadmap", "Compliance improvement roadmap — additional text (optional)", 3], ["closing", "Closing", 5],
];

const DONE: Record<string, string> = {
  submit: "Submitted for Super Administrator approval.",
  approve: "Approved and signed. The FINAL report is being generated.",
  issue: "Marked as issued to the client.",
  return: "Returned to draft.",
};

export default async function ReportBuilder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const user = await requireUser();
  const { id } = await params;
  const d = await withUser(user.id, async (tx) => ({
    versions: await tx`select r.*, g.full_name generator, a.full_name approver, p.file_name pdf_name, x.file_name xlsx_name
      from public.report_versions r left join public.users g on g.id = r.generated_by left join public.users a on a.id = r.approved_by
      left join public.source_documents p on p.id = r.pdf_document_id left join public.source_documents x on x.id = r.xlsx_document_id
      where r.engagement_id = ${id} order by r.version desc`,
    jobs: await tx`select id from public.jobs where engagement_id = ${id} and job_type = 'report.generate' and status in ('queued','running')`,
    counts: (await tx`select count(*) filter (where status in ('approved','shared_with_client','client_responded','final','resolved','closed'))::int approved,
      count(*) filter (where status not in ('approved','shared_with_client','client_responded','final','resolved','closed'))::int not_approved,
      count(*) filter (where ai_generated and ai_approved_by is null)::int ai_pending from public.audit_observations where engagement_id = ${id}`)[0],
  }));
  const current = d.versions.find((v) => v.status === "draft" || v.status === "pending_approval") ?? d.versions[0];
  const snap = current?.snapshot as ReportSnapshot | undefined;
  const hid = (v: { id?: unknown }) => <><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="version_id" value={String(v.id)} /></>;
  return (
    <div className="space-y-6">
      {done && DONE[done] ? <p role="status" className="rounded-md border border-hira-200 bg-hira-50 p-3 text-sm text-hira-800">{DONE[done]}</p> : null}
      {d.jobs.map((j) => <JobWatcher key={j.id} jobId={j.id} label="Generating report" />)}
      <Section title="Report builder" description="Reports are generated only from approved observations and their frozen calculation snapshots. Each version keeps its own snapshot; approved versions cannot be changed.">
        <div className="space-y-3 p-5 text-sm">
          <p>{d.counts.approved} approved observation(s) will be included. {d.counts.not_approved ? <span className="text-amber-700">{d.counts.not_approved} observation(s) are not yet approved and will be excluded.</span> : null}</p>
          {can(user, "reports.generate") ? (
            <ActionForm action={createReportVersionAction} submitLabel="Create new draft version" pendingText="Building snapshot…" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="engagement_id" value={id} />
              <Field label="Revision note"><Input name="revision_note" placeholder="e.g. Draft for management discussion" className="w-80" /></Field>
            </ActionForm>) : null}
        </div>
      </Section>
      <Section title="Versions and report archive">
        <Table><THead><TR><TH>Version</TH><TH>Label</TH><TH>Status</TH><TH>Observations</TH><TH>Generated</TH><TH>Approved / signed</TH><TH>Files</TH><TH>Workflow</TH></TR></THead>
          <TBody>{d.versions.length === 0 ? <Empty colSpan={8}>No report versions yet.</Empty> : d.versions.map((v) => (
            <TR key={v.id}>
              <TD className="font-semibold">v{v.version}<div className="text-xs font-normal text-muted-foreground">{v.revision_note}</div></TD>
              <TD><Badge variant={v.label === "FINAL" ? "default" : "medium"}>{v.label}</Badge></TD><TD><StatusBadge status={v.status} /></TD>
              <TD>{(v.snapshot as ReportSnapshot)?.observations?.length ?? 0}</TD>
              <TD className="text-xs">{v.generated_at ? fmtDateTime(v.generated_at) : "—"}<div className="text-muted-foreground">{v.generator}</div></TD>
              <TD className="text-xs">{v.approver ? <>{v.approver}<div className="text-muted-foreground">{fmtDateTime(v.approved_at)}</div></> : "—"}</TD>
              <TD className="text-xs">{v.pdf_document_id ? <a className="block text-primary hover:underline" href={`/api/files/${v.pdf_document_id}`}>PDF report</a> : "Generating…"}
                {v.xlsx_document_id ? <a className="block text-primary hover:underline" href={`/api/files/${v.xlsx_document_id}`}>Excel annexures</a> : null}
                <span className="font-mono text-[10px] text-muted-foreground">{v.snapshot_hash?.slice(0, 12)}</span></TD>
              <TD className="space-y-1">
                {v.status === "draft" && can(user, "reports.generate") ? <ActionForm action={reportWorkflowAction} inline submitLabel="Submit for approval">{hid(v)}<input type="hidden" name="op" value="submit" /></ActionForm> : null}
                {v.status === "pending_approval" && can(user, "reports.approve") ? <>
                  <ActionForm action={reportWorkflowAction} inline submitLabel="Approve & sign (FINAL)" confirm="Approve and sign this version? Its observations will be locked and the FINAL report generated.">{hid(v)}<input type="hidden" name="op" value="approve" /></ActionForm>
                  <ActionForm action={reportWorkflowAction} inline submitLabel="Return" submitVariant="ghost">{hid(v)}<input type="hidden" name="op" value="return" /><Input name="comment" placeholder="Reason" className="h-8 w-32 text-xs" /></ActionForm></> : null}
                {v.status === "approved" && can(user, "reports.approve") ? <ActionForm action={reportWorkflowAction} inline submitLabel="Mark as issued to client">{hid(v)}<input type="hidden" name="op" value="issue" /></ActionForm> : null}
                {can(user, "reports.generate") && v.status !== "superseded" ? <ActionForm action={regenerateAction} inline submitLabel="Regenerate files" submitVariant="ghost">{hid(v)}</ActionForm> : null}
              </TD>
            </TR>))}
          </TBody></Table>
      </Section>
      {snap && current ? (
        <>
          <Section title={`Financial impact in version ${current.version}`}><div className="p-4"><ImpactTable s={snap.impact} hrefBase={`/engagements/${id}/observations`} /></div></Section>
          {current.status === "draft" && can(user, "reports.generate") ? (
            <Section title={`Edit narrative — version ${current.version} (draft)`} description="Editing narrative sections does not change the frozen observations or figures. Saving regenerates the draft PDF.">
              <ActionForm action={saveReportContentAction} submitLabel="Save and regenerate" className="space-y-4 p-5">
                {hid(current)}
                {FIELDS.map(([k, label, rows]) => <Field key={k} label={label}><Textarea name={k} rows={rows} defaultValue={snap.content[k]} /></Field>)}
              </ActionForm>
            </Section>) : null}
        </>
      ) : null}
    </div>
  );
}
