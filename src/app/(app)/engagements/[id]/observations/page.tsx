import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { getEngagement } from "@/lib/queries";
import { MODULES } from "@/lib/engagements";
import { inr } from "@/lib/gst/money";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge, StatusBadge, Badge } from "@/components/ui/badge";
import { createObservationAction } from "./actions";

export default async function ObservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await getEngagement(user, id);
  const { rows, templates } = await withUser(user.id, async (tx) => ({
    rows: await tx`select o.*, g.gstin, l.name location from public.audit_observations o left join public.client_gstins g on g.id = o.client_gstin_id
      left join public.business_locations l on l.id = o.location_id where o.engagement_id = ${id} order by o.obs_number`,
    templates: await tx`select id, module, title from public.observation_templates where is_approved order by module, title`,
  }));
  return (
    <div className="space-y-6">
      <Section title="Summary of observations" description="Numbering runs continuously and is the numbering used in the report. Closed observations remain on record.">
        <Table>
          <THead><TR><TH>No.</TH><TH>Observation</TH><TH>Category</TH><TH>GSTIN / location</TH><TH className="text-right">Tax impact</TH><TH>Risk</TH><TH>Status</TH></TR></THead>
          <TBody>{rows.length === 0 ? <Empty colSpan={7}>No observations yet. Draft them from the exception register or start one below.</Empty> : rows.map((o) => (
            <TR key={o.id}>
              <TD className="font-semibold text-hira-700">{o.obs_number}</TD>
              <TD className="max-w-lg"><Link className="font-medium text-hira-800 hover:underline" href={`/engagements/${id}/observations/${o.id}`}>{o.title}</Link>
                <div className="flex gap-1">{o.is_repeat ? <Badge variant="medium">Repeat</Badge> : null}{o.ai_generated && !o.ai_approved_by ? <Badge variant="high">AI draft — not approved</Badge> : null}{o.locked ? <Badge variant="muted">Locked</Badge> : null}</div></TD>
              <TD className="text-xs">{o.category}<div className="text-muted-foreground">Module {o.module}</div></TD>
              <TD className="text-xs"><span className="font-mono">{o.gstin ?? "Entity"}</span>{o.location ? <div>{o.location}</div> : null}</TD>
              <TD className="num">{Number(o.tax_amount) ? `₹${inr(o.tax_amount, { decimals: 0 })}` : Number(o.contingent_amount) ? `₹${inr(o.contingent_amount, { decimals: 0 })} (contingent)` : Number(o.recoverable_amount) ? `₹${inr(o.recoverable_amount, { decimals: 0 })} recoverable` : o.impact_text ?? "To be quantified"}</TD>
              <TD><RiskBadge risk={o.risk_grade} /></TD><TD><StatusBadge status={o.status} /></TD>
            </TR>))}
          </TBody>
        </Table>
      </Section>
      {can(user, "observations.edit") ? (
        <Section title="Start an observation" description="Use an approved template from the observation library, or start blank.">
          <ActionForm action={createObservationAction} submitLabel="Create draft" className="grid gap-4 p-5 md:grid-cols-4">
            <input type="hidden" name="engagement_id" value={id} />
            <Field label="Template" className="md:col-span-2"><Select name="template_id" defaultValue=""><option value="">— blank —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.module} · {t.title}</option>)}</Select></Field>
            <Field label="Module"><Select name="module" defaultValue="B">{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select></Field>
            <Field label="GSTIN"><Select name="client_gstin_id" defaultValue=""><option value="">Entity</option>{e.gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}</option>)}</Select></Field>
            <Field label="Title (optional)" className="md:col-span-4"><Input name="title" /></Field>
          </ActionForm>
        </Section>
      ) : null}
    </div>
  );
}
