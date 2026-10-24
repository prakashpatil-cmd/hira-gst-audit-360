import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { GST_STATES } from "@/lib/gst/states";
import { inr } from "@/lib/gst/money";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ClientForm } from "../client-form";
import { addGstinAction, addLocationAction, toggleLocationAction, updateClientAction } from "../actions";
import { NoticeForm } from "./notice-form";

export const metadata = { title: "Client" };
const TABS = [["", "Profile"], ["gstins", "GST registrations"], ["locations", "Places of business"], ["engagements", "Engagements"], ["notices", "Notices & litigation"]] as const;
const REG_TYPES = ["regular", "composition", "isd", "sez_unit", "sez_developer", "casual", "nrtp", "tds", "tcs", "oidar", "uin"];
const LOC_TYPES = ["principal", "additional", "factory", "warehouse", "depot", "branch", "job_worker", "sez_unit", "ftwz", "office", "temporary"];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab = "" } = await searchParams;
  const data = await withUser(user.id, async (tx) => {
    const [client] = await tx`select * from public.clients where id = ${id}`;
    if (!client) return null;
    const gstins = await tx`select * from public.client_gstins where client_id = ${id} order by state_code, gstin`;
    const locations = await tx`select l.*, g.gstin from public.business_locations l left join public.client_gstins g on g.id = l.client_gstin_id
      where l.client_id = ${id} order by l.is_active desc, l.name`;
    const engagements = await tx`select id, engagement_code, title, financial_year, period_from, period_to, status from public.audit_engagements
      where client_id = ${id} order by period_from desc`;
    const notices = await tx`select n.*, g.gstin from public.notices n left join public.client_gstins g on g.id = n.client_gstin_id
      where n.client_id = ${id} order by coalesce(n.response_due, n.issue_date) desc nulls last`;
    return { client, gstins, locations, engagements, notices };
  });
  if (!data) notFound();
  const { client, gstins, locations, engagements, notices } = data;
  const manage = can(user, "clients.manage");

  return (
    <>
      <PageHeader title={client.legal_name} crumbs={[{ href: "/clients", label: "Client master" }, { label: client.legal_name }]}
        description={<>PAN <span className="font-mono">{client.pan}</span> · {gstins.length} registration(s) · {client.industry ?? "Industry not set"}</>}
        actions={can(user, "engagements.manage") ? <Button asChild><Link href={`/engagements/new?client=${id}`}><Plus />New engagement</Link></Button> : null} />
      <div className="mb-6 flex gap-1 border-b">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/clients/${id}${k ? `?tab=${k}` : ""}`}
            className={`border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary font-medium text-hira-800" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</Link>
        ))}
      </div>

      {tab === "" ? (
        <Card><CardContent className="pt-5">
          {manage ? <ClientForm action={updateClientAction} client={client} submitLabel="Save changes" /> : <pre className="text-sm">{JSON.stringify(client, null, 2)}</pre>}
        </CardContent></Card>
      ) : null}

      {tab === "gstins" ? (
        <div className="space-y-6">
          <Section title="GST registrations" description="Each registration's GSTIN is validated by checksum and must carry the client's PAN.">
            <Table>
              <THead><TR><TH>GSTIN</TH><TH>State</TH><TH>Label</TH><TH>Type</TH><TH>Status</TH><TH>Effective</TH><TH>E-invoice from</TH><TH>ISD from</TH></TR></THead>
              <TBody>
                {gstins.length === 0 ? <Empty colSpan={8}>No registrations yet.</Empty> : gstins.map((g) => (
                  <TR key={g.id}>
                    <TD className="font-mono text-xs">{g.gstin}</TD><TD>{g.state_code} — {GST_STATES[g.state_code]}</TD><TD>{g.label ?? "—"}</TD>
                    <TD>{g.registration_type}</TD><TD><StatusBadge status={g.status} /></TD><TD>{fmtDate(g.effective_date)}</TD>
                    <TD>{fmtDate(g.einvoice_applicable_from)}</TD><TD>{fmtDate(g.isd_effective_from)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          {manage ? (
            <Card><CardContent className="pt-5">
              <h3 className="mb-3 text-sm font-semibold">Add a registration</h3>
              <ActionForm action={addGstinAction} submitLabel="Add GSTIN" resetOnSuccess>
                <input type="hidden" name="client_id" value={id} />
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="GSTIN"><Input name="gstin" required maxLength={15} className="font-mono uppercase" /></Field>
                  <Field label="Label"><Input name="label" placeholder="Maharashtra — Bhiwandi factory" /></Field>
                  <Field label="Registration type"><Select name="registration_type" defaultValue="regular">{REG_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                  <Field label="Status"><Select name="status" defaultValue="active">{["active", "suspended", "cancelled", "provisional"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
                  <Field label="Effective date"><Input name="effective_date" type="date" /></Field>
                  <Field label="Cancellation date"><Input name="cancellation_date" type="date" /></Field>
                  <Field label="E-invoicing applicable from"><Input name="einvoice_applicable_from" type="date" /></Field>
                  <Field label="ISD effective from"><Input name="isd_effective_from" type="date" /></Field>
                  <Field label="Trade name"><Input name="trade_name" /></Field>
                  <Field label="Principal place of business" className="md:col-span-3"><Input name="principal_address" /></Field>
                  <Field label="Centre jurisdiction"><Input name="jurisdiction_centre" /></Field>
                  <Field label="State jurisdiction"><Input name="jurisdiction_state" /></Field>
                </div>
              </ActionForm>
            </CardContent></Card>
          ) : null}
        </div>
      ) : null}

      {tab === "locations" ? (
        <div className="space-y-6">
          <Section title="Places of business" description="Principal and additional places, factories, warehouses, depots, job-work and SEZ locations.">
            <Table>
              <THead><TR><TH>Name</TH><TH>Type</TH><TH>GSTIN</TH><TH>Address</TH><TH>On certificate</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {locations.length === 0 ? <Empty colSpan={7}>No locations recorded.</Empty> : locations.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-medium">{l.name}</TD><TD>{l.location_type.replace(/_/g, " ")}</TD><TD className="font-mono text-xs">{l.gstin ?? "—"}</TD>
                    <TD className="max-w-xs text-xs">{l.address ?? "—"}{l.pincode ? ` — ${l.pincode}` : ""}</TD>
                    <TD>{l.is_registered_on_portal ? <Badge variant="secondary">Yes</Badge> : <Badge variant="high">Not registered</Badge>}</TD>
                    <TD><StatusBadge status={l.is_active ? "active" : "inactive"} /></TD>
                    <TD>{manage ? <ActionForm action={toggleLocationAction} inline submitLabel={l.is_active ? "Deactivate" : "Activate"} submitVariant="ghost">
                      <input type="hidden" name="id" value={l.id} /><input type="hidden" name="client_id" value={id} /></ActionForm> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          {manage ? (
            <Card><CardContent className="pt-5">
              <h3 className="mb-3 text-sm font-semibold">Add a place of business</h3>
              <ActionForm action={addLocationAction} submitLabel="Add location" resetOnSuccess>
                <input type="hidden" name="client_id" value={id} />
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="Name"><Input name="name" required placeholder="Bhiwandi warehouse" /></Field>
                  <Field label="Type"><Select name="location_type" defaultValue="additional">{LOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select></Field>
                  <Field label="Registration"><Select name="client_gstin_id" defaultValue=""><option value="">— not linked —</option>{gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}</option>)}</Select></Field>
                  <Field label="PIN code"><Input name="pincode" maxLength={6} /></Field>
                  <Field label="Address" className="md:col-span-3"><Input name="address" /></Field>
                  <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="is_registered_on_portal" defaultChecked className="h-4 w-4" />Shown on registration certificate</label>
                </div>
              </ActionForm>
            </CardContent></Card>
          ) : null}
        </div>
      ) : null}

      {tab === "engagements" ? (
        <Section title="Audit engagements">
          <Table>
            <THead><TR><TH>Code</TH><TH>Title</TH><TH>FY</TH><TH>Period</TH><TH>Status</TH></TR></THead>
            <TBody>
              {engagements.length === 0 ? <Empty colSpan={5}>No engagements.</Empty> : engagements.map((e) => (
                <TR key={e.id}><TD><Link className="font-medium text-hira-800 hover:underline" href={`/engagements/${e.id}`}>{e.engagement_code}</Link></TD>
                  <TD>{e.title}</TD><TD>{e.financial_year}</TD><TD>{fmtDate(e.period_from)} – {fmtDate(e.period_to)}</TD><TD><StatusBadge status={e.status} /></TD></TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      {tab === "notices" ? (
        <div className="space-y-6">
          <Section title="Notices, audits and litigation" description="ASMT-10, ADT-01/02, DRC-01A/01/07, appeals and GSTAT proceedings with deadlines and demand amounts.">
            <Table>
              <THead><TR><TH>Form</TH><TH>Reference</TH><TH>GSTIN</TH><TH>Issued</TH><TH>Period</TH><TH>Section</TH><TH className="text-right">Tax</TH><TH className="text-right">Interest</TH><TH className="text-right">Penalty</TH><TH>Reply due</TH><TH>Hearing</TH><TH>Appeal by</TH><TH>Status</TH></TR></THead>
              <TBody>
                {notices.length === 0 ? <Empty colSpan={13}>No notices recorded.</Empty> : notices.map((n) => {
                  const overdue = n.response_due && n.status === "open" && n.response_due < new Date().toISOString().slice(0, 10);
                  return (
                    <TR key={n.id}>
                      <TD className="font-medium">{n.form_type}</TD><TD className="text-xs">{n.reference_no ?? "—"}<div className="text-muted-foreground">{n.subject}</div></TD>
                      <TD className="font-mono text-xs">{n.gstin ?? "—"}</TD><TD>{fmtDate(n.issue_date)}</TD><TD className="text-xs">{fmtDate(n.period_from)} – {fmtDate(n.period_to)}</TD>
                      <TD>{n.section ?? "—"}</TD><TD className="num">{inr(n.demand_tax, { decimals: 0 })}</TD><TD className="num">{inr(n.demand_interest, { decimals: 0 })}</TD>
                      <TD className="num">{inr(n.demand_penalty, { decimals: 0 })}</TD>
                      <TD className={overdue ? "font-medium text-red-700" : ""}>{fmtDate(n.response_due)}</TD><TD>{fmtDate(n.hearing_date)}</TD><TD>{fmtDate(n.appeal_due)}</TD>
                      <TD><StatusBadge status={n.status} /></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Section>
          <Card><CardContent className="pt-5"><h3 className="mb-3 text-sm font-semibold">Record a notice or order</h3>
            <NoticeForm clientId={id} gstins={gstins.map((g) => ({ id: g.id as string, gstin: g.gstin as string }))} engagements={engagements.map((e) => ({ id: e.id as string, code: e.engagement_code as string }))} />
          </CardContent></Card>
        </div>
      ) : null}
    </>
  );
}
