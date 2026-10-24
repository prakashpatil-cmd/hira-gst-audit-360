import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { fmtDate } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, RiskBadge, StatusBadge } from "@/components/ui/badge";

const STATUSES = ["not_started", "data_awaited", "in_progress", "passed", "exception_detected", "under_investigation", "pending_client", "pending_review", "confirmed_observation", "resolved", "closed", "not_applicable"];

export default async function ChecklistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ module?: string; status?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rows = await withUser(user.id, (tx) => tx`
    select t.control_id, t.status, t.exceptions_count, t.tested_at, t.reviewed_at, t.applicability_note, cardinality(t.evidence_document_ids) evidence,
      coalesce(length(t.work_performed), 0) > 0 has_work, ac.module, ac.category, ac.title, cv.risk_level, cv.automation, cv.status cv_status, cv.version,
      u.full_name tester, rv.full_name reviewer
    from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id join public.control_versions cv on cv.id = t.control_version_id
    left join public.users u on u.id = t.tested_by left join public.users rv on rv.id = t.reviewed_by
    where t.engagement_id = ${id} ${sp.module ? tx`and ac.module = ${sp.module}` : tx``} ${sp.status ? tx`and t.status = ${sp.status}` : tx``}
    order by ac.module, t.control_id`);
  return (
    <Section title="Audit control checklist" description="Each control's procedure, evidence and conclusion form the working paper. A control counts as tested only when work or evidence is recorded."
      actions={
        <form className="flex gap-2">
          <Select name="module" defaultValue={sp.module ?? ""} className="h-8 w-56 text-xs"><option value="">All modules</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="h-8 w-44 text-xs"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
          <Button size="sm" variant="outline">Filter</Button>
        </form>}>
      <Table>
        <THead><TR><TH>Control</TH><TH>Title</TH><TH>Risk</TH><TH>Mode</TH><TH className="text-right">Exceptions</TH><TH className="text-right">Evidence</TH><TH>Tested</TH><TH>Reviewed</TH><TH>Status</TH></TR></THead>
        <TBody>{rows.length === 0 ? <Empty colSpan={9}>No controls match. If the library was empty when the engagement was created, use “Refresh audit programme” on the Planning tab.</Empty> : rows.map((r) => (
          <TR key={r.control_id}>
            <TD className="whitespace-nowrap font-mono text-xs"><Link className="text-hira-800 hover:underline" href={`/engagements/${id}/checklist/${r.control_id}`}>{r.control_id}</Link>
              {r.cv_status !== "approved" ? <div><Badge variant="medium">v{r.version} pending approval</Badge></div> : null}</TD>
            <TD className="max-w-md"><div>{r.title}</div><div className="text-xs text-muted-foreground">{r.category}{r.applicability_note ? ` · ${r.applicability_note}` : ""}</div></TD>
            <TD><RiskBadge risk={r.risk_level} /></TD>
            <TD className="text-xs">{r.automation ? <Badge variant="secondary">Automated</Badge> : "Manual"}</TD>
            <TD className="num">{r.exceptions_count || "—"}</TD><TD className="num">{r.evidence || (r.has_work ? "notes" : "—")}</TD>
            <TD className="text-xs">{r.tester ? <>{r.tester}<div className="text-muted-foreground">{fmtDate(r.tested_at)}</div></> : "—"}</TD>
            <TD className="text-xs">{r.reviewer ?? "—"}</TD>
            <TD><StatusBadge status={r.status} /></TD>
          </TR>))}
        </TBody>
      </Table>
    </Section>
  );
}
