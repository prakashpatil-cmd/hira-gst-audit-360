import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { DATASET_MAP } from "@/lib/import/datasets";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtDateTime, fmtPeriod } from "@/lib/gst/dates";
import { IMPACT_BUCKETS, bucketFor } from "@/lib/observations";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { RiskBadge, StatusBadge } from "@/components/ui/badge";
import { triageExceptionAction } from "../../reconciliation/actions";

export default async function ExceptionDetail({ params }: { params: Promise<{ id: string; exId: string }> }) {
  const user = await requireUser();
  const { id, exId } = await params;
  const d = await withUser(user.id, async (tx) => {
    const [x] = await tx`select x.*, g.gstin our_gstin, r.recon_type, r.id run_id, r.is_current, u.full_name resolver
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id left join public.client_gstins g on g.id = x.client_gstin_id
      left join public.users u on u.id = x.resolved_by where x.id = ${exId} and x.engagement_id = ${id}`;
    if (!x) return null;
    const src = await tx`select st.id, st.dataset_type, st.row_number, st.raw, st.row_status, st.issues, d.file_name, d.id doc_id, i.version, i.id import_id
      from public.source_transactions st join public.data_imports i on i.id = st.import_id join public.source_documents d on d.id = i.source_document_id
      where st.id = any(${x.source_ids}::uuid[]) order by st.dataset_type, st.row_number`;
    const [m] = x.match_id ? await tx`select * from public.reconciliation_matches where id = ${x.match_id}` : [];
    const staff = await tx`select u.id, u.full_name from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id}`;
    return { x, src, m, staff };
  });
  if (!d) notFound();
  const { x } = d;
  const groups = new Map<string, (typeof d.src)[number][]>();
  for (const s of d.src) (groups.get(s.dataset_type) ?? groups.set(s.dataset_type, []).get(s.dataset_type)!).push(s);
  const canEdit = can(user, "recon.run");
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/engagements/${id}/exceptions`} className="text-xs text-muted-foreground hover:underline">← Exception register</Link>
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-hira-800">{x.exception_type.replace(/_/g, " ")} <RiskBadge risk={x.severity} /> <StatusBadge status={x.status} /></h2>
        <p className="text-sm">{x.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">Module {x.module}{x.control_id ? <> · control <Link className="text-primary hover:underline" href={`/engagements/${id}/checklist/${x.control_id}`}>{x.control_id}</Link></> : null}
          {" "}· {x.our_gstin ?? "entity"} · run <Link className="text-primary hover:underline" href={`/engagements/${id}/reconciliation/${x.run_id}`}>{x.recon_type}</Link>{x.is_current ? "" : " (superseded)"}
          {" "}· suggested impact bucket: {IMPACT_BUCKETS[bucketFor(x.exception_type)]}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Difference detected">
          <dl className="grid grid-cols-2 gap-2 p-5 text-sm">
            <dt className="text-muted-foreground">Document</dt><dd>{x.doc_no ?? "—"} {x.doc_date ? `(${fmtDate(x.doc_date)})` : ""}</dd>
            <dt className="text-muted-foreground">Counterparty</dt><dd>{x.counterparty_name ?? "—"}<div className="font-mono text-xs">{x.counterparty_gstin ?? ""}</div></dd>
            <dt className="text-muted-foreground">Period</dt><dd>{fmtPeriod(x.period)}</dd>
            <dt className="text-muted-foreground">Taxable value</dt><dd className="num">₹{inr(x.diff_taxable)}</dd>
            <dt className="text-muted-foreground">IGST</dt><dd className="num">₹{inr(x.diff_igst)}</dd>
            <dt className="text-muted-foreground">CGST</dt><dd className="num">₹{inr(x.diff_cgst)}</dd>
            <dt className="text-muted-foreground">SGST</dt><dd className="num">₹{inr(x.diff_sgst)}</dd>
            <dt className="text-muted-foreground">Cess</dt><dd className="num">₹{inr(x.diff_cess)}</dd>
            <dt className="font-medium">Total tax</dt><dd className="num font-semibold">₹{inr(x.diff_tax)}</dd>
          </dl>
          {d.m ? <div className="border-t p-4 text-xs text-muted-foreground">Match status {d.m.match_status} via {d.m.match_method}{d.m.diff?.flags?.length ? ` · flags ${d.m.diff.flags.join(", ")}` : ""}</div> : null}
        </Section>
        <div className="lg:col-span-2">
          <Section title="Investigation and triage">
            <div className="p-5">
              {x.observation_id ? <p className="mb-3 text-sm">Converted into <Link className="text-primary hover:underline" href={`/engagements/${id}/observations/${x.observation_id}`}>an observation</Link>.</p> : null}
              {x.resolution_note ? <p className="mb-3 rounded-md bg-muted p-2 text-sm">Explanation: {x.resolution_note}{x.resolver ? ` — ${x.resolver}, ${fmtDateTime(x.resolved_at)}` : ""}</p> : null}
              {canEdit && x.status !== "converted" ? (
                <ActionForm action={triageExceptionAction} className="space-y-3">
                  <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="ids[]" value={x.id} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Status"><Select name="status" defaultValue={x.status}><option value="open">Open</option><option value="under_investigation">Under investigation</option><option value="explained">Explained</option><option value="not_an_issue">Not an issue</option></Select></Field>
                    <Field label="Classification"><Select name="classification" defaultValue={x.classification ?? ""}><option value="">—</option>{["confirmed", "probable", "requires_investigation", "documentary_deficiency", "potential_opportunity", "not_applicable", "resolved"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</Select></Field>
                    <Field label="Assigned to"><Select name="assigned_to" defaultValue={x.assigned_to ?? ""}><option value="">—</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
                  </div>
                  <Field label="Explanation / investigation notes"><Input name="resolution_note" defaultValue={x.resolution_note ?? ""} /></Field>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">Save</button>
                    {can(user, "observations.edit") ? <button name="op" value="observation" className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-accent">Draft observation from this exception</button> : null}
                  </div>
                </ActionForm>
              ) : null}
            </div>
          </Section>
        </div>
      </div>
      <Section title="Original source records" description="The rows exactly as they appear in the uploaded files, with file version and row number.">
        <div className="space-y-4 p-4">
          {Array.from(groups.entries()).map(([ds, rows]) => {
            const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.raw)))).slice(0, 18);
            return (
              <div key={ds}>
                <p className="mb-1 text-sm font-semibold">{DATASET_MAP.get(ds)?.label ?? ds}</p>
                <Table>
                  <THead><TR><TH>File / row</TH>{keys.map((k) => <TH key={k} className="normal-case">{k}</TH>)}</TR></THead>
                  <TBody>{rows.map((r) => (
                    <TR key={r.id}><TD className="whitespace-nowrap text-xs"><Link className="text-primary hover:underline" href={`/engagements/${id}/imports/${r.import_id}?rows=`}>{r.file_name}</Link><div className="text-muted-foreground">v{r.version} · row {r.row_number}</div></TD>
                      {keys.map((k) => <TD key={k} className="whitespace-nowrap text-xs">{r.raw[k] == null ? "" : String(r.raw[k])}</TD>)}</TR>))}
                  </TBody>
                </Table>
              </div>
            );
          })}
          {d.src.length === 0 ? <p className="text-sm text-muted-foreground">No source rows linked (aggregate-level exception).</p> : null}
        </div>
      </Section>
    </div>
  );
}
