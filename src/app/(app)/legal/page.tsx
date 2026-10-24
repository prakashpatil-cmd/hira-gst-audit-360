import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { proposeLegalAction, reviewLegalAction } from "./actions";

export const metadata = { title: "Legal research library" };

export default async function LegalLibrary({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const like = `%${sp.q ?? ""}%`;
  const rows = await withUser(user.id, (tx) => tx`select l.*, u.full_name verifier,
      (select count(*)::int from public.control_versions cv where l.code = any(cv.law_refs)) used_by
    from public.legal_references l left join public.users u on u.id = l.verified_by
    where (${!sp.q} or l.code ilike ${like} or l.title ilike ${like} or l.provision ilike ${like} or l.summary ilike ${like} or l.notification_no ilike ${like})
      and (${!sp.type} or l.source_type = ${sp.type ?? ""}) and (${!sp.status} or l.approval_status = ${sp.status ?? ""})
    order by l.source_type, l.code limit 500`);
  const approver = can(user, "legal.approve");
  return (
    <>
      <PageHeader title="Legal research library" description="Version-controlled references to the CGST/IGST Acts and Rules, notifications, circulars, advisories and judgments. Unverified references show “Legal Review Required” wherever they are used; the application never fabricates citations." />
      <Section title={`${rows.length} reference(s)`} actions={
        <form className="flex flex-wrap gap-2"><Input name="q" defaultValue={sp.q} placeholder="Section, rule, notification…" className="h-8 w-56 text-xs" />
          <Select name="type" defaultValue={sp.type ?? ""} className="h-8 w-32 text-xs"><option value="">Any source</option>{["act", "rule", "notification", "circular", "advisory", "judgment", "council", "other"].map((t) => <option key={t}>{t}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="h-8 w-32 text-xs"><option value="">Any approval</option><option value="pending">pending</option><option value="approved">approved</option><option value="rejected">rejected</option></Select>
          <Button size="sm" variant="outline">Search</Button></form>}>
        <Table><THead><TR><TH>Reference</TH><TH>Summary</TH><TH>Effective</TH><TH>Status</TH><TH>Verification</TH>{approver ? <TH>Review</TH> : null}</TR></THead>
          <TBody>{rows.length === 0 ? <Empty colSpan={6}>No references found.</Empty> : rows.map((r) => (
            <TR key={r.id}>
              <TD className="max-w-xs"><div className="font-medium">{r.provision ?? r.code}</div><div className="text-xs text-muted-foreground">{r.statute ?? r.source_type}{r.notification_no ? ` · ${r.notification_no}` : ""}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{r.code} · used by {r.used_by} control(s)</div></TD>
              <TD className="max-w-xl text-sm"><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{r.summary}</div>
                {r.source_url ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Official source</a> : <span className="text-xs text-amber-700">No official source recorded</span>}</TD>
              <TD className="text-xs">{fmtDate(r.effective_from)}{r.effective_to ? ` – ${fmtDate(r.effective_to)}` : ""}{r.publication_date ? <div className="text-muted-foreground">Published {fmtDate(r.publication_date)}</div> : null}</TD>
              <TD><Badge variant={r.legal_status === "effective" ? "secondary" : r.legal_status === "proposed" ? "medium" : "muted"}>{r.legal_status.replace(/_/g, " ")}</Badge></TD>
              <TD>{r.approval_status === "approved" ? <Badge variant="secondary">Verified{r.verifier ? ` — ${r.verifier}` : ""}</Badge> : <Badge variant="medium">Legal review required</Badge>}</TD>
              {approver ? <TD><ActionForm action={reviewLegalAction} inline><input type="hidden" name="id" value={r.id} />
                <Select name="op" className="h-8 w-32 text-xs" defaultValue="approve"><option value="approve">Approve</option><option value="review_required">Needs review</option><option value="reject">Reject</option></Select>
                <button className="rounded border px-2 py-1 text-xs hover:bg-muted">Apply</button></ActionForm></TD> : null}
            </TR>))}</TBody></Table>
      </Section>
      {can(user, "legal.propose") ? (
        <div className="mt-6"><Section title="Propose a reference" description="Only official government sources are accepted as source URLs. A proposed reference is distinct from an enacted and effective requirement until approved.">
          <ActionForm action={proposeLegalAction} submitLabel="Propose" resetOnSuccess className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Code"><Input name="code" required placeholder="CGST-ACT-S16-4" className="uppercase" /></Field>
              <Field label="Source type"><Select name="source_type">{["act", "rule", "notification", "circular", "order", "advisory", "judgment", "council", "instruction", "other"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Provision"><Input name="provision" placeholder="Section 16(4)" /></Field>
              <Field label="Statute"><Input name="statute" placeholder="Central Goods and Services Tax Act, 2017" /></Field>
              <Field label="Title" className="md:col-span-2"><Input name="title" required /></Field>
              <Field label="Notification / circular no."><Input name="notification_no" /></Field>
              <Field label="Jurisdiction"><Select name="jurisdiction"><option value="central">Central</option><option value="igst">IGST</option><option value="customs">Customs</option><option value="state:MH">State — Maharashtra</option></Select></Field>
              <Field label="Official source URL" className="md:col-span-2"><Input name="source_url" type="url" placeholder="https://cbic-gst.gov.in/…" /></Field>
              <Field label="Publication date"><Input name="publication_date" type="date" /></Field>
              <Field label="Effective from"><Input name="effective_from" type="date" /></Field>
              <Field label="Effective to"><Input name="effective_to" type="date" /></Field>
              <Field label="Applicable FYs" hint="Comma separated"><Input name="applicable_fys" placeholder="2024-25, 2025-26" /></Field>
              <Field label="Legal status"><Select name="legal_status" defaultValue="effective"><option value="proposed">Proposed</option><option value="enacted_not_effective">Enacted, not yet effective</option><option value="effective">Effective</option><option value="superseded">Superseded</option><option value="omitted">Omitted</option></Select></Field>
            </div>
            <Field label="Summary"><Textarea name="summary" rows={2} /></Field>
          </ActionForm>
        </Section></div>) : null}
    </>
  );
}
