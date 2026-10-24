import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge, Badge } from "@/components/ui/badge";
import { saveTemplateAction } from "./actions";

export const metadata = { title: "Observation library" };
type SP = { q?: string; module?: string; risk?: string; fy?: string; industry?: string; section?: string };

export default async function Library({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const like = `%${sp.q ?? ""}%`, sec = `%${sp.section ?? ""}%`;
  const d = await withUser(user.id, async (tx) => ({
    templates: await tx`select * from public.observation_templates where is_approved
      and (${!sp.q} or title ilike ${like} or observation_text ilike ${like} or ${sp.q ?? ""} = any(tags))
      and (${!sp.module} or module = ${sp.module ?? ""}) and (${!sp.risk} or risk_grade = ${sp.risk ?? ""})
      and (${!sp.section} or legal_framework ilike ${sec}) and (${!sp.industry} or ${sp.industry ?? ""} = any(industries) or cardinality(industries) = 0)
      order by module, title limit 200`,
    // Past observations: RLS limits these to engagements the user may see.
    past: await tx`select o.id, o.engagement_id, o.obs_number, o.title, o.module, o.risk_grade, o.category, e.financial_year, c.industry, c.legal_name
      from public.audit_observations o join public.audit_engagements e on e.id = o.engagement_id join public.clients c on c.id = o.client_id
      where o.status in ('approved','shared_with_client','client_responded','final','resolved','closed')
        and (${!sp.q} or o.title ilike ${like} or o.observation_text ilike ${like} or o.action_required ilike ${like})
        and (${!sp.module} or o.module = ${sp.module ?? ""}) and (${!sp.risk} or o.risk_grade = ${sp.risk ?? ""}) and (${!sp.fy} or e.financial_year = ${sp.fy ?? ""})
        and (${!sp.section} or o.legal_framework ilike ${sec}) and (${!sp.industry} or c.industry ilike ${"%" + (sp.industry ?? "") + "%"})
      order by o.created_at desc limit 200`,
  }));
  return (
    <>
      <PageHeader title="Observation library" description="Approved generic templates and earlier observations. Client-specific observations are shown only from engagements you are permitted to access." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Issue / keyword / tag" className="h-9 w-56" />
        <Input name="section" defaultValue={sp.section} placeholder="Section or rule, e.g. 17(5)" className="h-9 w-44" />
        <Select name="module" defaultValue={sp.module ?? ""} className="h-9 w-52"><option value="">Any module</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select>
        <Select name="risk" defaultValue={sp.risk ?? ""} className="h-9 w-32"><option value="">Any risk</option>{["critical", "high", "medium", "low", "opportunity"].map((r) => <option key={r}>{r}</option>)}</Select>
        <Input name="fy" defaultValue={sp.fy} placeholder="FY 2025-26" className="h-9 w-28" />
        <Input name="industry" defaultValue={sp.industry} placeholder="Industry" className="h-9 w-32" />
        <Button variant="outline">Search</Button>
      </form>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={`Templates (${d.templates.length})`}>
          <Table><THead><TR><TH>Template</TH><TH>Module</TH><TH>Risk</TH></TR></THead>
            <TBody>{d.templates.length === 0 ? <Empty colSpan={3}>No templates match.</Empty> : d.templates.map((t) => (
              <TR key={t.id}><TD><details><summary className="cursor-pointer font-medium text-hira-800">{t.title}</summary>
                <div className="mt-2 space-y-2 whitespace-pre-line text-xs"><p>{t.observation_text}</p><p className="text-muted-foreground">{t.legal_framework}</p><p>{t.action_required}</p>
                  <div className="flex flex-wrap gap-1">{t.tags.map((g: string) => <Badge key={g} variant="muted">{g}</Badge>)}</div></div></details></TD>
                <TD className="text-xs">{t.module} · {t.category}</TD><TD><RiskBadge risk={t.risk_grade} /></TD></TR>))}</TBody></Table>
        </Section>
        <Section title={`Earlier observations (${d.past.length})`}>
          <Table><THead><TR><TH>Observation</TH><TH>Client / FY</TH><TH>Risk</TH></TR></THead>
            <TBody>{d.past.length === 0 ? <Empty colSpan={3}>No earlier observations match.</Empty> : d.past.map((o) => (
              <TR key={o.id}><TD><Link className="text-hira-800 hover:underline" href={`/engagements/${o.engagement_id}/observations/${o.id}`}>{o.title}</Link><div className="text-xs text-muted-foreground">Module {o.module} · {o.category}</div></TD>
                <TD className="text-xs">{o.legal_name}<div className="text-muted-foreground">FY {o.financial_year} · {o.industry ?? ""}</div></TD><TD><RiskBadge risk={o.risk_grade} /></TD></TR>))}</TBody></Table>
        </Section>
      </div>
      {can(user, "observations.approve") ? (
        <div className="mt-6"><Section title="Add an approved generic template" description="Templates must not contain client names, GSTINs or figures — use placeholders such as {{voucher_no}}.">
          <ActionForm action={saveTemplateAction} submitLabel="Save template" resetOnSuccess className="space-y-3 p-5">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Title" className="md:col-span-2"><Input name="title" required /></Field>
              <Field label="Module"><Select name="module">{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select></Field>
              <Field label="Risk"><Select name="risk_grade" defaultValue="medium">{["critical", "high", "medium", "low", "opportunity"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Category"><Input name="category" required /></Field>
              <Field label="Tags"><Input name="tags" placeholder="rcm, foreign software" /></Field>
              <Field label="Industries"><Input name="industries" placeholder="pharmaceutical, chemicals" /></Field>
            </div>
            <Field label="Observation"><Textarea name="observation_text" rows={3} required /></Field>
            <Field label="Legal framework"><Textarea name="legal_framework" rows={3} /></Field>
            <Field label="Action required"><Textarea name="action_required" rows={3} required /></Field>
            <Field label="Preventive control"><Textarea name="preventive_control" rows={2} /></Field>
          </ActionForm>
        </Section></div>) : null}
    </>
  );
}
