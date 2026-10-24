import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { redirect } from "next/navigation";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ruleAction } from "../actions";

export const metadata = { title: "Rule engine" };

export default async function RulesPage() {
  const user = await requireUser();
  if (!can(user, "rules.propose") && !can(user, "rules.approve")) redirect("/dashboard");
  const { rules, controls, pins } = await withUser(user.id, async (tx) => ({
    rules: await tx`select r.*, p.full_name proposer, a.full_name approver from public.rule_definitions r left join public.users p on p.id = r.proposed_by
      left join public.users a on a.id = r.approved_by order by r.rule_code, r.version desc`,
    controls: await tx`select cv.id, cv.control_id, cv.version, cv.status, ac.title from public.control_versions cv join public.audit_controls ac on ac.id = cv.control_id
      where cv.status in ('pending_approval','draft') order by cv.control_id limit 200`,
    pins: await tx`select r.rule_code, r.version, count(*)::int engagements from public.engagement_rule_pins p join public.rule_definitions r on r.id = p.rule_definition_id group by 1, 2`,
  }));
  const pinMap = new Map(pins.map((p) => [`${p.rule_code}:${p.version}`, p.engagements]));
  const approve = can(user, "rules.approve");
  return (
    <>
      <PageHeader title="Rule engine console" description="Versioned calculation rules (interest, limitation, penalty, thresholds). Changes are proposed as new versions, need a different approver, and never alter engagements or reports already using an earlier version." />
      <Section title="Calculation rules">
        <Table><THead><TR><TH>Rule</TH><TH>Version</TH><TH>Parameters</TH><TH>Effective</TH><TH>Legal basis</TH><TH>Status</TH><TH>Pinned by</TH>{approve ? <TH>Review</TH> : null}</TR></THead>
          <TBody>{rules.map((r) => (
            <TR key={r.id}>
              <TD><div className="font-mono text-xs">{r.rule_code}</div><div className="text-sm">{r.title}</div><div className="text-xs text-muted-foreground">{r.change_note}</div></TD>
              <TD>v{r.version}</TD><TD className="font-mono text-xs">{JSON.stringify(r.params)}</TD>
              <TD className="text-xs">{fmtDate(r.effective_from)}{r.effective_to ? ` – ${fmtDate(r.effective_to)}` : ""}</TD>
              <TD className="font-mono text-[11px]">{r.legal_basis.join(", ")}</TD>
              <TD>{r.status === "approved" ? <Badge variant="secondary">Approved{r.approver ? ` — ${r.approver}` : ""}</Badge> : <Badge variant="medium">{r.status.replace(/_/g, " ")}</Badge>}
                {r.proposer ? <div className="text-xs text-muted-foreground">Proposed by {r.proposer}</div> : null}</TD>
              <TD className="text-xs">{pinMap.get(`${r.rule_code}:${r.version}`) ?? 0} engagement(s)</TD>
              {approve ? <TD>{r.status !== "approved" && r.status !== "retired" ? <ActionForm action={ruleAction} inline><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="rule" />
                <Select name="op" className="h-8 w-28 text-xs"><option value="approve">Approve</option><option value="reject">Return</option></Select><button className="rounded border px-2 py-1 text-xs hover:bg-muted">Apply</button></ActionForm>
                : r.status === "approved" ? <ActionForm action={ruleAction} inline submitLabel="Retire" submitVariant="ghost" confirm="Retire this rule version?"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="rule" /><input type="hidden" name="op" value="retire" /></ActionForm> : null}</TD> : null}
            </TR>))}</TBody></Table>
      </Section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {can(user, "rules.propose") ? (
          <Section title="Propose a rule change">
            <ActionForm action={ruleAction} submitLabel="Propose new version" resetOnSuccess className="space-y-3 p-5">
              <input type="hidden" name="op" value="propose" />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Rule"><Select name="rule_code">{Array.from(new Set(rules.map((r) => r.rule_code))).map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Title"><Input name="title" required /></Field>
                <Field label="Effective from"><Input name="effective_from" type="date" required /></Field>
                <Field label="Effective to"><Input name="effective_to" type="date" /></Field>
                <Field label="Legal basis codes" className="md:col-span-2"><Input name="legal_basis" placeholder="CGST-ACT-S50-1" /></Field>
              </div>
              <Field label="Parameters (JSON)"><Textarea name="params" rows={3} className="font-mono text-xs" defaultValue={'{"rate_pa": 18}'} /></Field>
              <Field label="Reason for change and source"><Textarea name="change_note" rows={2} required /></Field>
            </ActionForm>
          </Section>) : null}
        <Section title="Control versions awaiting approval">
          <Table><THead><TR><TH>Control</TH><TH>Version</TH><TH>Status</TH>{approve ? <TH /> : null}</TR></THead>
            <TBody>{controls.length === 0 ? <Empty colSpan={4}>None pending.</Empty> : controls.map((c) => (
              <TR key={c.id}><TD><span className="font-mono text-xs">{c.control_id}</span> {c.title}</TD><TD>v{c.version}</TD><TD><Badge variant="medium">{c.status}</Badge></TD>
                {approve ? <TD><ActionForm action={ruleAction} inline submitLabel="Approve"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value="control" /><input type="hidden" name="op" value="approve" /></ActionForm></TD> : null}</TR>))}</TBody></Table>
        </Section>
      </div>
    </>
  );
}
