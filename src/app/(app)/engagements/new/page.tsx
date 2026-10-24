import { requirePagePermission } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createEngagementAction } from "../actions";

export const metadata = { title: "New engagement" };
const TYPES = [["health_check", "GST Health Check"], ["annual_return_review", "Annual return (GSTR-9/9C) review"], ["pre_departmental_audit", "Pre-departmental audit review"],
  ["notice_support", "Notice / scrutiny support"], ["special_review", "Special review"], ["refund_review", "Refund review"]];

export default async function NewEngagementPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const user = await requirePagePermission("engagements.manage");
  const { client } = await searchParams;
  const data = await withUser(user.id, async (tx) => {
    const clients = await tx`select id, legal_name from public.clients where status = 'active' order by legal_name`;
    if (!client) return { clients, gstins: [], locations: [], staff: [] };
    const gstins = await tx`select id, gstin, label from public.client_gstins where client_id = ${client} order by gstin`;
    const locations = await tx`select l.id, l.name, l.location_type, g.gstin from public.business_locations l left join public.client_gstins g on g.id = l.client_gstin_id
      where l.client_id = ${client} and l.is_active order by l.name`;
    const staff = await tx`select u.id, u.full_name, m.role_code from public.users u join public.memberships m on m.user_id = u.id
      where m.organisation_id = ${user.orgId} and m.role_code <> 'client_user' and m.is_active and u.is_active order by u.full_name`;
    return { clients, gstins, locations, staff };
  });
  const byRole = (roles: string[]) => data.staff.filter((s) => roles.includes(s.role_code));
  return (
    <>
      <PageHeader title="New engagement" crumbs={[{ href: "/engagements", label: "Engagements" }, { label: "New" }]}
        description="The control checklist, rule versions and document request list are created automatically from the client profile." />
      <Card className="mb-4"><CardContent className="pt-5">
        <form className="flex items-end gap-3">
          <Field label="Client" className="w-96">
            <Select name="client" defaultValue={client ?? ""} required>
              <option value="" disabled>Select a client…</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="outline">Continue</Button>
        </form>
      </CardContent></Card>
      {client ? (
        <Card><CardContent className="pt-5">
          {data.gstins.length === 0 ? <p className="text-sm text-destructive">Add at least one GST registration to this client first.</p> : (
            <ActionForm action={createEngagementAction} submitLabel="Create engagement">
              <input type="hidden" name="client_id" value={client} />
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Title" className="md:col-span-2"><Input name="title" required defaultValue="GST Health Check" /></Field>
                <Field label="Audit type"><Select name="audit_type">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                <div />
                <Field label="Review period from"><Input name="period_from" type="date" required /></Field>
                <Field label="Review period to"><Input name="period_to" type="date" required /></Field>
                <Field label="Data request date"><Input name="data_request_date" type="date" /></Field>
                <Field label="Completion deadline"><Input name="completion_deadline" type="date" /></Field>
                <Field label="Materiality (₹)" hint="Drives risk grading of quantified exceptions"><Input name="materiality_amount" defaultValue="10000" inputMode="decimal" /></Field>
                <Field label="Rounding tolerance per document (₹)"><Input name="tolerance_amount" defaultValue="1.00" inputMode="decimal" /></Field>
                <Field label="Engagement partner"><Select name="engagement_partner_id" defaultValue="">{[<option key="" value="">—</option>, ...byRole(["super_admin"]).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)]}</Select></Field>
                <Field label="Reviewing manager"><Select name="reviewing_manager_id" defaultValue="">{[<option key="" value="">—</option>, ...byRole(["super_admin", "audit_manager"]).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)]}</Select></Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm font-medium">GSTINs in scope</legend>
                  {data.gstins.map((g) => <label key={g.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="gstins[]" value={g.id} defaultChecked className="h-4 w-4" /><span className="font-mono text-xs">{g.gstin}</span> {g.label}</label>)}
                </fieldset>
                <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm font-medium">Locations covered</legend>
                  {data.locations.length === 0 ? <p className="text-xs text-muted-foreground">No locations recorded for this client.</p> :
                    data.locations.map((l) => <label key={l.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="locations[]" value={l.id} className="h-4 w-4" />{l.name} <span className="text-xs text-muted-foreground">({l.location_type}{l.gstin ? `, ${l.gstin}` : ""})</span></label>)}
                </fieldset>
                <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm font-medium">GST auditors</legend>
                  {byRole(["gst_auditor", "audit_manager", "super_admin"]).map((s) => <label key={s.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="auditors[]" value={s.id} className="h-4 w-4" />{s.full_name}</label>)}
                </fieldset>
                <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm font-medium">Audit assistants</legend>
                  {byRole(["audit_assistant"]).length === 0 ? <p className="text-xs text-muted-foreground">No assistants.</p> :
                    byRole(["audit_assistant"]).map((s) => <label key={s.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="assistants[]" value={s.id} className="h-4 w-4" />{s.full_name}</label>)}
                </fieldset>
              </div>
              <Field label="Scope"><Textarea name="scope" rows={3} placeholder="Outward supplies and credit notes, exports and ICEGATE transmission, ITC including bills of entry, RCM on imports of services, ISD, e-way bill and e-invoice discipline, fixed asset disposals, electronic ledgers and periodic reconciliations." /></Field>
              <Field label="Exclusions / limitations"><Textarea name="exclusions" rows={2} /></Field>
            </ActionForm>
          )}
        </CardContent></Card>
      ) : null}
    </>
  );
}
