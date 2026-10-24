import { exceptionLabel } from "@/lib/recon/labels";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { DATASET_MAP } from "@/lib/import/datasets";
import { fmtDateTime } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, RiskBadge, StatusBadge } from "@/components/ui/badge";
import { updateTestResultAction } from "../../work-actions";

const STATUSES = ["not_started", "data_awaited", "in_progress", "passed", "exception_detected", "under_investigation", "pending_client", "pending_review", "confirmed_observation", "resolved", "closed", "not_applicable"];

export default async function ControlWorkingPaper({ params }: { params: Promise<{ id: string; controlId: string }> }) {
  const user = await requireUser();
  const { id, controlId } = await params;
  const d = await withUser(user.id, async (tx) => {
    const [t] = await tx`select t.*, ac.module, ac.category, ac.title, cv.*, t.status as status, cv.status as cv_status, t.id as tid
      from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id join public.control_versions cv on cv.id = t.control_version_id
      where t.engagement_id = ${id} and t.control_id = ${controlId} and t.client_gstin_id is null`;
    if (!t) return null;
    const refs = await tx`select code, title, provision, statute, verification_status, approval_status from public.legal_references where code = any(${t.law_refs})`;
    const evidence = await tx`select id, file_name, created_at from public.source_documents where id = any(${t.evidence_document_ids})`;
    const exs = await tx`select x.exception_type, x.severity, count(*)::int n from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      where x.engagement_id = ${id} and r.is_current and x.control_id = ${controlId} group by 1, 2 order by 3 desc`;
    const staff = await tx`select u.id, u.full_name from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id}`;
    return { t, refs, evidence, exs, staff };
  });
  if (!d) notFound();
  const { t } = d;
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/engagements/${id}/checklist`} className="text-xs text-muted-foreground hover:underline">← Checklist</Link>
        <h2 className="text-lg font-semibold text-hira-800">{controlId} — {t.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Module {t.module} ({MODULES[t.module]}) · {t.category} · <RiskBadge risk={t.risk_level} /> <StatusBadge status={t.status} />
          {t.cv_status !== "approved" ? <Badge variant="medium">Control v{t.version} pending approval</Badge> : <Badge variant="secondary">Control v{t.version}</Badge>}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Audit programme">
          <dl className="space-y-3 p-5 text-sm">
            <div><dt className="field-label">Objective</dt><dd>{t.objective}</dd></div>
            <div><dt className="field-label">Procedure</dt><dd className="whitespace-pre-line">{t.procedure}</dd></div>
            <div><dt className="field-label">Required data</dt><dd>{t.required_data.map((r: string) => DATASET_MAP.get(r)?.label ?? r).join(", ") || "—"}</dd></div>
            <div><dt className="field-label">Expected result</dt><dd>{t.expected_result}</dd></div>
            <div><dt className="field-label">Exception conditions</dt><dd>{t.exception_conditions}</dd></div>
            <div><dt className="field-label">Exposure basis</dt><dd>{t.exposure_basis ?? "—"}</dd></div>
            <div><dt className="field-label">Evidence required</dt><dd><ul className="list-disc pl-5">{t.evidence_required.map((e: string) => <li key={e}>{e}</li>)}</ul></dd></div>
            <div><dt className="field-label">Recommended corrective action</dt><dd>{t.corrective_action}</dd></div>
            <div><dt className="field-label">Legal basis</dt><dd>{d.refs.map((r) => (
              <div key={r.code} className="flex flex-wrap items-center gap-2"><Link href={`/legal?q=${encodeURIComponent(r.code)}`} className="text-primary hover:underline">{r.provision ?? r.code}</Link>
                <span className="text-xs text-muted-foreground">{r.statute} — {r.title}</span>
                {r.approval_status !== "approved" ? <Badge variant="medium">Legal review required</Badge> : null}</div>))}</dd></div>
          </dl>
        </Section>
        <div className="space-y-6">
          <Section title="Automated results">
            <div className="p-5 text-sm">
              {t.automation ? <p className="mb-2 text-muted-foreground">Linked to {t.automation.engine === "recon" ? `reconciliation ${t.automation.type}` : `check ${t.automation.key}`}.</p> : <p className="text-muted-foreground">Manual control — record your work below.</p>}
              {d.exs.length ? <ul className="space-y-1">{d.exs.map((x) => <li key={x.exception_type + x.severity}><Link className="text-primary hover:underline" href={`/engagements/${id}/exceptions?type=${x.exception_type}`}>{exceptionLabel(x.exception_type)}</Link> — {x.n} <RiskBadge risk={x.severity} /></li>)}</ul> : null}
            </div>
          </Section>
          <Section title="Working paper">
            <div className="p-5">
              {can(user, "checklist.edit") ? (
                <ActionForm action={updateTestResultAction} submitLabel="Save working paper">
                  <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="control_id" value={controlId} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Status"><Select name="status" defaultValue={t.status}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select></Field>
                    <Field label="Assigned to"><Select name="assigned_to" defaultValue={t.assigned_to ?? ""}><option value="">—</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
                  </div>
                  <Field label="Work performed"><Textarea name="work_performed" rows={5} defaultValue={t.work_performed ?? ""} placeholder="Records examined, sample selected, tests applied and results." /></Field>
                  <Field label="Conclusion"><Textarea name="conclusion" rows={2} defaultValue={t.conclusion ?? ""} /></Field>
                  <Field label="Applicability note"><Input name="applicability_note" defaultValue={t.applicability_note ?? ""} /></Field>
                  <Field label="Attach evidence"><Input type="file" name="evidence" multiple /></Field>
                  {["super_admin", "audit_manager"].includes(user.role) ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" className="h-4 w-4" />Sign off as reviewer</label> : null}
                </ActionForm>
              ) : <p className="whitespace-pre-line text-sm">{t.work_performed ?? "No work recorded."}</p>}
              <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                <p>Tested: {t.tested_at ? fmtDateTime(t.tested_at) : "—"} · Reviewed: {t.reviewed_at ? fmtDateTime(t.reviewed_at) : "—"}</p>
                {d.evidence.length ? <ul className="mt-2 space-y-1">{d.evidence.map((e) => <li key={e.id}><a className="text-primary hover:underline" href={`/api/files/${e.id}`}>{e.file_name}</a> · {fmtDateTime(e.created_at)}</li>)}</ul> : null}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
