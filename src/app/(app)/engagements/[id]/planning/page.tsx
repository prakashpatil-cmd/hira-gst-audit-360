import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getEngagement } from "@/lib/queries";
import { STAGES, MODULES, classesOf } from "@/lib/engagements";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { updateEngagementAction, refreshProgrammeAction } from "../../actions";

export default async function PlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await getEngagement(user, id);
  const { client, modules, pins } = await withUser(user.id, async (tx) => {
    const [client] = await tx`select * from public.clients where id = ${e.client_id}`;
    const modules = await tx`select ac.module, count(*)::int total, count(*) filter (where t.status <> 'not_applicable')::int applicable,
        count(*) filter (where cv.risk_level in ('critical','high') and t.status <> 'not_applicable')::int high_risk
      from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id join public.control_versions cv on cv.id = t.control_version_id
      where t.engagement_id = ${id} group by ac.module order by ac.module`;
    const pins = await tx`select r.rule_code, r.version, r.status, r.title from public.engagement_rule_pins p join public.rule_definitions r on r.id = p.rule_definition_id
      where p.engagement_id = ${id} order by r.rule_code`;
    return { client, modules, pins };
  });
  const classes = Array.from(classesOf(client as never, e.gstins.length));
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Risk profile" description="Derived from the client master; determines which controls apply.">
          <div className="space-y-3 p-5 text-sm">
            <div className="flex flex-wrap gap-1">{classes.map((c) => <Badge key={c} variant="secondary">{c.replace(/_/g, " ")}</Badge>)}</div>
            <p className="text-muted-foreground">Industry: {client.industry ?? "—"} · AATO ₹{client.aato_crore ?? "—"} crore · {client.accounting_software ?? "accounting system not recorded"}</p>
            {e.is_manager ? <ActionForm action={refreshProgrammeAction} inline submitLabel="Refresh audit programme" submitVariant="outline">
              <input type="hidden" name="engagement_id" value={id} /></ActionForm> : null}
          </div>
        </Section>
        <div className="lg:col-span-2">
          <Section title="Applicability by audit module">
            <Table><THead><TR><TH>Module</TH><TH className="text-right">Controls</TH><TH className="text-right">Applicable</TH><TH className="text-right">High / critical</TH></TR></THead>
              <TBody>{modules.map((m) => <TR key={m.module}><TD>{m.module} — {MODULES[m.module]}</TD><TD className="num">{m.total}</TD><TD className="num">{m.applicable}</TD><TD className="num">{m.high_risk}</TD></TR>)}</TBody></Table>
          </Section>
        </div>
      </div>
      <Section title="Engagement scope, dates and stage">
        <div className="p-5">
          {e.is_manager ? (
            <ActionForm action={updateEngagementAction} submitLabel="Save">
              <input type="hidden" name="id" value={id} />
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Title" className="md:col-span-2"><Input name="title" defaultValue={e.title} required /></Field>
                <Field label="Stage"><Select name="status" defaultValue={e.status}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.n}. {s.label}</option>)}</Select></Field>
                <Field label="Report issue date"><Input name="report_issue_date" type="date" defaultValue={e.report_issue_date ?? ""} /></Field>
                <Field label="Data request date"><Input name="data_request_date" type="date" defaultValue={e.data_request_date ?? ""} /></Field>
                <Field label="Completion deadline"><Input name="completion_deadline" type="date" defaultValue={e.completion_deadline ?? ""} /></Field>
                <Field label="Materiality (₹)"><Input name="materiality_amount" defaultValue={e.materiality_amount} /></Field>
                <Field label="Rounding tolerance (₹)"><Input name="tolerance_amount" defaultValue={e.tolerance_amount} /></Field>
              </div>
              <Field label="Scope"><Textarea name="scope" defaultValue={e.scope ?? ""} rows={4} /></Field>
              <Field label="Exclusions and data limitations"><Textarea name="exclusions" defaultValue={e.exclusions ?? ""} rows={2} /></Field>
              <fieldset className="grid gap-4 rounded-md border p-3 md:grid-cols-3"><legend className="px-1 text-sm font-medium">Add an audit visit</legend>
                <Field label="Location / label"><Input name="visit_label" placeholder="Bhiwandi" /></Field>
                <Field label="From"><Input name="visit_from" type="date" /></Field>
                <Field label="To"><Input name="visit_to" type="date" /></Field>
              </fieldset>
            </ActionForm>
          ) : <p className="text-sm text-muted-foreground">Only the engagement manager or partner can change the plan.</p>}
        </div>
      </Section>
      <Section title="Pinned calculation rules" description="Rule versions fixed for this engagement. Later rule changes do not alter this engagement or its reports.">
        <Table><THead><TR><TH>Rule</TH><TH>Title</TH><TH>Version</TH><TH>Approval</TH></TR></THead>
          <TBody>{pins.map((p) => <TR key={p.rule_code}><TD className="font-mono text-xs">{p.rule_code}</TD><TD>{p.title}</TD><TD>v{p.version}</TD>
            <TD>{p.status === "approved" ? <Badge variant="secondary">Approved</Badge> : <Badge variant="medium">Legal review required</Badge>}</TD></TR>)}</TBody></Table>
      </Section>
    </div>
  );
}
