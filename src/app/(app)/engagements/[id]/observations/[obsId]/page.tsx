import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { getEngagement } from "@/lib/queries";
import { MODULES } from "@/lib/engagements";
import { IMPACT_BUCKETS } from "@/lib/observations";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtDateTime } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, RiskBadge, StatusBadge } from "@/components/ui/badge";
import { AiPanel } from "./ai-panel";
import { saveObservationAction, saveImpactAction, workflowAction, addEvidenceAction, responseAction, addActionItemAction } from "../actions";

const WF = ["not_started", "data_awaited", "in_progress", "exception_detected", "under_investigation", "pending_client", "pending_review", "confirmed_observation", "resolved", "closed", "not_applicable"];

export default async function ObservationEditor({ params, searchParams }: { params: Promise<{ id: string; obsId: string }>; searchParams: Promise<{ moved?: string }> }) {
  const { moved } = await searchParams;
  const user = await requireUser();
  const { id, obsId } = await params;
  const e = await getEngagement(user, id);
  const d = await withUser(user.id, async (tx) => {
    const [o] = await tx`select o.*, u.full_name preparer from public.audit_observations o left join public.users u on u.id = o.created_by where o.id = ${obsId} and o.engagement_id = ${id}`;
    if (!o) return null;
    const [calc] = o.calc_snapshot_id ? await tx`select * from public.financial_calculations where id = ${o.calc_snapshot_id}` : [null];
    const evidence = await tx`select ev.*, d.file_name, u.full_name from public.observation_evidence ev left join public.source_documents d on d.id = ev.source_document_id
      left join public.users u on u.id = ev.added_by where ev.observation_id = ${obsId} order by ev.created_at`;
    const exceptions = await tx`select id, exception_type, doc_no, doc_date, diff_tax, severity from public.reconciliation_exceptions where id = any(${o.source_exception_ids}::uuid[]) order by doc_date nulls last limit 200`;
    const responses = await tx`select r.*, u.full_name reviewer from public.management_responses r left join public.users u on u.id = r.reviewed_by where r.observation_id = ${obsId} order by r.created_at`;
    const actions = await tx`select * from public.corrective_actions where observation_id = ${obsId} order by priority, due_date nulls last`;
    const history = await tx`select a.*, u.full_name from public.review_approvals a join public.users u on u.id = a.actor_id where a.entity_type = 'observation' and a.entity_id = ${obsId} order by a.created_at desc`;
    const refs = await tx`select code, provision, statute, approval_status from public.legal_references where code = any(${o.legal_reference_codes})`;
    const staff = await tx`select u.id, u.full_name from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id}`;
    const locations = await tx`select l.id, l.name from public.engagement_locations el join public.business_locations l on l.id = el.location_id where el.engagement_id = ${id}`;
    return { o, calc, evidence, exceptions, responses, actions, history, refs, staff, locations };
  });
  if (!d) notFound();
  const { o } = d;
  const editable = can(user, "observations.edit") && !o.locked;
  const hid = <><input type="hidden" name="id" value={obsId} /><input type="hidden" name="engagement_id" value={id} /></>;
  const wf = (op: string, label: string, variant: "default" | "outline" | "ghost" = "outline", needsComment = false) => (
    <ActionForm key={op} action={workflowAction} inline>
      {hid}<input type="hidden" name="op" value={op} />
      {needsComment ? <Input name="comment" placeholder="Comment (required)" className="h-8 w-56 text-xs" /> : null}
      <button className={`rounded-md px-3 py-1.5 text-xs font-medium ${variant === "default" ? "bg-primary text-white" : "border hover:bg-muted"}`}>{label}</button>
    </ActionForm>
  );
  const ops: React.ReactNode[] = [];
  if (["draft", "changes_requested"].includes(o.status) && can(user, "observations.edit")) ops.push(wf("submit", "Submit for review", "default"));
  if (o.status === "pending_review" && can(user, "observations.approve")) ops.push(wf("approve", "Approve", "default"));
  if (["pending_review", "approved"].includes(o.status) && can(user, "observations.review")) ops.push(wf("request_changes", "Request changes", "outline", true));
  if (o.status === "approved" && can(user, "observations.approve")) ops.push(wf("share", "Share with client"));
  if (["approved", "shared_with_client", "client_responded"].includes(o.status) && can(user, "observations.approve")) ops.push(wf("final", "Finalise & lock"));
  if (["approved", "shared_with_client", "client_responded", "final"].includes(o.status) && can(user, "observations.approve")) ops.push(wf("reopen", "Reopen", "ghost", true));
  if (o.status === "final") ops.push(wf("resolve", "Mark resolved"));
  if (["final", "resolved"].includes(o.status) && can(user, "observations.approve")) ops.push(wf("close", "Close"));
  const outputs = d.calc?.outputs ?? null;

  return (
    <div className="space-y-6">
      {moved && /^[a-z_]+$/.test(moved) ? <p role="status" className="rounded-md border border-hira-200 bg-hira-50 p-3 text-sm text-hira-800">Observation moved to {moved.replace(/_/g, " ")}.</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/engagements/${id}/observations`} className="text-xs text-muted-foreground hover:underline">← Observations</Link>
          <h2 className="text-lg font-semibold text-hira-800">Observation {o.obs_number}: {o.title}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Category: <b className="text-foreground">{o.category}</b> · Indicative impact:
            <b className="text-foreground">{Number(o.tax_amount) ? `₹${inr(o.tax_amount, { decimals: 0 })}` : o.impact_text ?? "To be quantified"}</b> · Risk: <RiskBadge risk={o.risk_grade} /> <StatusBadge status={o.status} />
            {o.locked ? <Badge variant="muted">Locked for report</Badge> : null}{o.ai_generated ? <Badge variant={o.ai_approved_by ? "secondary" : "high"}>{o.ai_approved_by ? "AI-assisted, approved" : "AI-assisted draft"}</Badge> : null}</p>
          <p className="text-xs text-muted-foreground">Prepared by {o.preparer} · last updated {fmtDateTime(o.updated_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{ops}</div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Observation (report text)" description={o.locked ? "Locked: reopen through the review workflow to edit." : "Sections A–H appear in the report exactly as written here."}>
            <ActionForm action={saveObservationAction} submitLabel={editable ? "Save" : undefined} className="space-y-4 p-5">
              {hid}
              <fieldset disabled={!editable} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Title" className="md:col-span-3"><Input name="title" defaultValue={o.title} /></Field>
                  <Field label="Category"><Input name="category" defaultValue={o.category} /></Field>
                  <Field label="Module"><Select name="module" defaultValue={o.module ?? "B"}>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select></Field>
                  <Field label="GSTIN"><Select name="client_gstin_id" defaultValue={o.client_gstin_id ?? ""}><option value="">Entity</option>{e.gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}</option>)}</Select></Field>
                  <Field label="Location"><Select name="location_id" defaultValue={o.location_id ?? ""}><option value="">—</option>{d.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                  <Field label="Report part (optional)"><Input name="part_label" defaultValue={o.part_label ?? ""} placeholder="Part A — Bhiwandi" /></Field>
                  <Field label="Risk grade"><Select name="risk_grade" defaultValue={o.risk_grade}>{["critical", "high", "medium", "low", "opportunity"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
                  <Field label="Classification"><Select name="classification" defaultValue={o.classification}>{["confirmed", "probable", "requires_investigation", "documentary_deficiency", "potential_opportunity", "not_applicable", "resolved"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</Select></Field>
                  <Field label="Confidence"><Select name="confidence" defaultValue={o.confidence}>{["high", "medium", "low"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
                  <Field label="Audit status"><Select name="workflow_status" defaultValue={o.workflow_status}>{WF.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</Select></Field>
                </div>
                <Field label="A. Observation" hint="The fact as found, with exact document, voucher or portal references."><Textarea name="observation_text" rows={7} defaultValue={o.observation_text} /></Field>
                <Field label="B. Legal framework" hint="Cite sections, rules, notifications and circulars by number. Write “Legal Review Required” where the position is uncertain.">
                  <Textarea name="legal_framework" rows={6} defaultValue={o.legal_framework} /></Field>
                {d.refs.length ? <div className="flex flex-wrap gap-2 text-xs">{d.refs.map((r) => <Badge key={r.code} variant={r.approval_status === "approved" ? "secondary" : "medium"}>{r.provision ?? r.code}{r.approval_status === "approved" ? "" : " · legal review required"}</Badge>)}</div> : null}
                <Field label="C. Financial implication"><Textarea name="financial_implication" rows={4} defaultValue={o.financial_implication} /></Field>
                <Field label="D. Root cause"><Textarea name="root_cause" rows={2} defaultValue={o.root_cause} /></Field>
                <Field label="E. Action required"><Textarea name="action_required" rows={5} defaultValue={o.action_required} /></Field>
                <Field label="F. Preventive control"><Textarea name="preventive_control" rows={2} defaultValue={o.preventive_control} /></Field>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="H. Responsible (team)"><Select name="responsible_user_id" defaultValue={o.responsible_user_id ?? ""}><option value="">—</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
                  <Field label="Client action owner"><Input name="action_owner_name" defaultValue={o.action_owner_name ?? ""} /></Field>
                  <Field label="Target date"><Input name="target_date" type="date" defaultValue={o.target_date ?? ""} /></Field>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="is_repeat" defaultChecked={o.is_repeat} className="h-4 w-4" />Repeat observation</label>
                </div>
              </fieldset>
            </ActionForm>
          </Section>

          <Section title="G. Management response" description="Only responses approved by a manager appear in the report.">
            <div className="space-y-3 p-5">
              {d.responses.length === 0 ? <p className="text-sm text-muted-foreground">No response recorded.</p> : d.responses.map((r) => (
                <div key={r.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>{r.responder_name} · {fmtDate(r.response_date)}</span><StatusBadge status={r.status} /></div>
                  <p className="whitespace-pre-line">{r.response_text}</p>
                  {can(user, "observations.approve") && r.status === "submitted" ? <div className="mt-2 flex gap-2">
                    {(["approve", "reject"] as const).map((op) => <ActionForm key={op} action={responseAction} inline submitLabel={op === "approve" ? "Approve for report" : "Reject"} submitVariant={op === "approve" ? "default" : "ghost"}>
                      <input type="hidden" name="observation_id" value={obsId} /><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="op" value={op} /><input type="hidden" name="response_id" value={r.id} /></ActionForm>)}
                  </div> : null}
                </div>))}
              {can(user, "observations.edit") ? (
                <ActionForm action={responseAction} submitLabel="Record response" resetOnSuccess>
                  <input type="hidden" name="observation_id" value={obsId} /><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="op" value="add" />
                  <div className="grid gap-3 md:grid-cols-4"><Field label="Responder"><Input name="responder_name" placeholder="CFO / Finance Head" /></Field>
                    <Field label="Response" className="md:col-span-3"><Textarea name="response_text" rows={2} /></Field></div>
                </ActionForm>) : null}
            </div>
          </Section>

          <Section title="Corrective actions">
            <Table><THead><TR><TH>Action</TH><TH>Owner</TH><TH>Due</TH><TH>Statutory deadline</TH><TH className="text-right">Amount</TH><TH>Status</TH></TR></THead>
              <TBody>{d.actions.length === 0 ? <Empty colSpan={6}>No actions yet.</Empty> : d.actions.map((a) => (
                <TR key={a.id}><TD>{a.title}<div className="text-xs text-muted-foreground">{a.compliance_step}</div></TD><TD>{a.owner_name ?? "—"}</TD><TD>{fmtDate(a.due_date)}</TD>
                  <TD>{fmtDate(a.statutory_deadline)}</TD><TD className="num">{a.amount ? `₹${inr(a.amount, { decimals: 0 })}` : a.amount_label ?? "—"}</TD><TD><StatusBadge status={a.status} /></TD></TR>))}</TBody></Table>
            {can(user, "actions.manage") ? (
              <ActionForm action={addActionItemAction} submitLabel="Add action" resetOnSuccess className="space-y-3 border-t p-5">
                <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="observation_id" value={obsId} />
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Action" className="md:col-span-2"><Input name="title" required placeholder="Reverse ITC through DRC-03 with interest" /></Field>
                  <Field label="Compliance step"><Select name="compliance_step" defaultValue=""><option value="">—</option>{["DRC-03", "GSTR-3B adjustment", "GSTR-1 amendment (Table 9A)", "PMT-09", "Self-invoice (Sec. 31(3)(f))", "Refund (RFD-01)", "Documentation", "Process / control change"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
                  <Field label="Priority (1 = urgent)"><Select name="priority" defaultValue="2">{[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}</Select></Field>
                  <Field label="Client owner"><Input name="owner_name" defaultValue={o.action_owner_name ?? ""} /></Field>
                  <Field label="Due date"><Input name="due_date" type="date" defaultValue={o.target_date ?? ""} /></Field>
                  <Field label="Statutory deadline"><Input name="statutory_deadline" type="date" /></Field>
                  <Field label="Amount (₹)"><Input name="amount" defaultValue={Number(o.tax_amount) ? o.tax_amount : ""} /></Field>
                </div>
              </ActionForm>) : null}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Financial impact" description="Figures come from the deterministic engine or a recorded manual working — never from AI.">
            <div className="space-y-3 p-5 text-sm">
              <p className="text-xs text-muted-foreground">{IMPACT_BUCKETS[o.impact_bucket ?? "NONE"]}</p>
              <dl className="grid grid-cols-2 gap-1">
                <dt>Tax</dt><dd className="num font-semibold">₹{inr(o.tax_amount)}</dd>
                <dt className="text-muted-foreground">IGST / CGST / SGST</dt><dd className="num text-xs">{inr(o.igst, { decimals: 0 })} / {inr(o.cgst, { decimals: 0 })} / {inr(o.sgst, { decimals: 0 })}</dd>
                <dt>Interest (indicative)</dt><dd className="num">₹{inr(o.interest_amount)}</dd>
                <dt>ITC re-available</dt><dd className="num">₹{inr(o.itc_reavailable)}</dd>
                <dt>Potential penalty</dt><dd className="num">₹{inr(o.penalty_amount)}</dd>
                <dt>Recoverable</dt><dd className="num">₹{inr(o.recoverable_amount)}</dd>
                <dt>Contingent</dt><dd className="num">₹{inr(o.contingent_amount)}</dd>
                <dt>Value affected</dt><dd className="num">₹{inr(o.affected_value)}</dd>
              </dl>
              {d.calc ? <div className="rounded-md bg-muted p-2 text-xs">Snapshot {String(d.calc.id).slice(0, 8)} · {d.calc.calc_type.replace(/_/g, " ")} · {fmtDateTime(d.calc.created_at)} · engine {d.calc.engine_version}
                {outputs?.limitation ? <div>Limitation: {outputs.limitation.basis}; notice by {fmtDate(outputs.limitation.scnBy)}</div> : null}
                {(outputs?.notes ?? []).map((n: string, i: number) => <div key={i} className="mt-1">• {n}</div>)}</div> : <p className="text-xs text-amber-700">No calculation snapshot — the observation is unquantified.</p>}
              {editable ? (
                <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Edit quantification</summary>
                  <ActionForm action={saveImpactAction} submitLabel="Record working" className="mt-3 space-y-3">
                    {hid}
                    <Field label="Impact bucket"><Select name="impact_bucket" defaultValue={o.impact_bucket ?? "NONE"}>{Object.entries(IMPACT_BUCKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                    <div className="grid grid-cols-2 gap-2">
                      {[["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"], ["interest_amount", "Interest"], ["penalty_amount", "Potential penalty"], ["itc_reavailable", "ITC re-available"],
                        ["recoverable_amount", "Recoverable"], ["contingent_amount", "Contingent"], ["affected_value", "Value affected"]].map(([k, l]) =>
                        <Field key={k} label={l}><Input name={k} defaultValue={o[k] ?? "0"} /></Field>)}
                    </div>
                    <Field label="Impact text when unquantified"><Input name="impact_text" defaultValue={o.impact_text ?? ""} /></Field>
                    <Field label="Basis of the working"><Textarea name="basis" rows={2} required placeholder="e.g. 18% IGST on ₹1,70,523 per vouchers SER/2627/632 and 1498" /></Field>
                    {o.source_exception_ids.length ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="recompute" value="1" className="h-4 w-4" />Recompute from linked exceptions instead (engine)</label> : null}
                  </ActionForm>
                </details>) : null}
            </div>
          </Section>

          <Section title="Supporting evidence">
            <ul className="space-y-2 p-5 text-sm">{d.evidence.length === 0 ? <li className="text-muted-foreground">None yet.</li> : d.evidence.map((ev) => (
              <li key={ev.id}>{ev.source_document_id ? <a className="text-primary hover:underline" href={`/api/files/${ev.source_document_id}`}>{ev.file_name}</a> : <span>{ev.source_transaction_ids.length} source row(s)</span>}
                <div className="text-xs text-muted-foreground">{ev.description} · {ev.full_name}</div></li>))}</ul>
            {can(user, "observations.edit") ? <ActionForm action={addEvidenceAction} submitLabel="Add evidence" resetOnSuccess className="space-y-2 border-t p-5">{hid}
              <Field label="Description"><Input name="description" required /></Field><Input type="file" name="file" /></ActionForm> : null}
          </Section>

          {d.exceptions.length ? (
            <Section title={`Linked exceptions (${o.source_exception_ids.length})`}>
              <ul className="max-h-72 space-y-1 overflow-y-auto p-4 text-xs">{d.exceptions.map((x) => (
                <li key={x.id}><Link className="text-primary hover:underline" href={`/engagements/${id}/exceptions/${x.id}`}>{x.doc_no ?? x.exception_type}</Link> · {fmtDate(x.doc_date)} · ₹{inr(x.diff_tax, { decimals: 0 })} <RiskBadge risk={x.severity} /></li>))}</ul>
            </Section>) : null}

          <AiPanel observationId={obsId} engagementId={id} />

          <Section title="Review history">
            <ul className="space-y-2 p-5 text-xs">{d.history.length === 0 ? <li className="text-muted-foreground">No review actions yet.</li> : d.history.map((h) => (
              <li key={h.id}><b>{h.full_name}</b> — {h.action.replace(/_/g, " ")} · {fmtDateTime(h.created_at)}{h.comment ? <div className="text-muted-foreground">{h.comment}</div> : null}</li>))}</ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
