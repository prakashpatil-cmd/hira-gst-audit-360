import { ActionForm, type ActionState } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { GST_STATES } from "@/lib/gst/states";

type C = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FLAGS: [string, string][] = [
  ["is_exporter", "Exporter (LUT / shipping bills)"], ["is_importer", "Importer (bills of entry)"], ["is_merchant_exporter", "Merchant exporter"],
  ["supplies_to_sez", "Supplies to SEZ / FTWZ"], ["has_job_work", "Job work (Section 143)"], ["has_related_party_txns", "Related-party transactions"],
  ["has_overseas_txns", "Overseas / cross-border transactions"], ["einvoice_applicable", "E-invoicing applicable"], ["eway_applicable", "E-way bills applicable"],
  ["isd_applicable", "Input Service Distributor"],
];
const CONSTITUTIONS = ["private_limited", "public_limited", "llp", "partnership", "proprietorship", "trust", "society", "huf", "government", "foreign_company", "other"];

export function ClientForm({ action, client, submitLabel }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; client?: C; submitLabel: string }) {
  const c = client ?? {};
  const contact = (c.contacts ?? [])[0] ?? {};
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {c.id ? <input type="hidden" name="id" value={c.id} /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Legal entity name" className="md:col-span-2"><Input name="legal_name" defaultValue={c.legal_name} required /></Field>
        <Field label="Trade name"><Input name="trade_name" defaultValue={c.trade_name ?? ""} /></Field>
        <Field label="PAN"><Input name="pan" defaultValue={c.pan} required maxLength={10} className="uppercase" placeholder="AABCT1234C" /></Field>
        <Field label="CIN / LLPIN"><Input name="cin" defaultValue={c.cin ?? ""} /></Field>
        <Field label="Constitution">
          <Select name="constitution" defaultValue={c.constitution ?? "private_limited"}>
            {CONSTITUTIONS.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
          </Select>
        </Field>
        <Field label="Registered address" className="md:col-span-2"><Input name="registered_address" defaultValue={c.registered_address ?? ""} /></Field>
        <Field label="State of registered office">
          <Select name="state_code" defaultValue={c.state_code ?? "27"}>
            {Object.entries(GST_STATES).filter(([k]) => +k < 90).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </Select>
        </Field>
        <Field label="Industry"><Input name="industry" defaultValue={c.industry ?? ""} placeholder="e.g. Diagnostics / Chemicals" /></Field>
        <Field label="Business activities" hint="Comma separated"><Input name="business_activities" defaultValue={(c.business_activities ?? []).join(", ")} placeholder="Manufacturing, Trading, Services" /></Field>
        <Field label="Accounting software"><Input name="accounting_software" defaultValue={c.accounting_software ?? ""} placeholder="Tally Prime / SAP S/4HANA / Oracle / Busy" /></Field>
        <Field label="Aggregate annual turnover (₹ crore)" hint="Drives e-invoice and GSTR-9C applicability checks"><Input name="aato_crore" type="number" step="0.01" min="0" defaultValue={c.aato_crore ?? ""} /></Field>
      </div>
      <fieldset className="rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Business profile (drives the audit programme and document request list)</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FLAGS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={k} defaultChecked={!!c[k] || (k === "eway_applicable" && !client)} className="h-4 w-4 accent-[hsl(var(--primary))]" />{label}</label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-4">
        <legend className="px-1 text-sm font-medium">Authorised contact person</legend>
        <Field label="Name"><Input name="contact_name" defaultValue={contact.name ?? ""} /></Field>
        <Field label="Designation"><Input name="contact_designation" defaultValue={contact.designation ?? ""} /></Field>
        <Field label="Email"><Input name="contact_email" type="email" defaultValue={contact.email ?? ""} /></Field>
        <Field label="Phone"><Input name="contact_phone" defaultValue={contact.phone ?? ""} /></Field>
      </fieldset>
      <Field label="Notes"><Textarea name="notes" defaultValue={c.notes ?? ""} rows={2} /></Field>
    </ActionForm>
  );
}
