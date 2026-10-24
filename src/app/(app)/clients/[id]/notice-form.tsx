import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addNoticeAction } from "./notice-actions";

const FORMS = ["ASMT-10", "ASMT-11", "ASMT-12", "ADT-01", "ADT-02", "DRC-01A", "DRC-01", "DRC-03", "DRC-06", "DRC-07", "APL-01", "APL-02", "GSTAT", "RFD-08", "RFD-09", "RFD-06", "OTHER"];

export function NoticeForm({ clientId, gstins, engagements }: { clientId: string; gstins: { id: string; gstin: string }[]; engagements: { id: string; code: string }[] }) {
  return (
    <ActionForm action={addNoticeAction} submitLabel="Record notice" resetOnSuccess>
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Form"><Select name="form_type">{FORMS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
        <Field label="Reference / DIN"><Input name="reference_no" /></Field>
        <Field label="GSTIN"><Select name="client_gstin_id" defaultValue=""><option value="">—</option>{gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}</option>)}</Select></Field>
        <Field label="Linked engagement"><Select name="engagement_id" defaultValue=""><option value="">—</option>{engagements.map((e) => <option key={e.id} value={e.id}>{e.code}</option>)}</Select></Field>
        <Field label="Subject" className="md:col-span-2"><Input name="subject" /></Field>
        <Field label="Section invoked"><Input name="section" placeholder="73 / 74 / 74A / 61 / 65" /></Field>
        <Field label="Issue date"><Input name="issue_date" type="date" /></Field>
        <Field label="Period from"><Input name="period_from" type="date" /></Field>
        <Field label="Period to"><Input name="period_to" type="date" /></Field>
        <Field label="Reply due"><Input name="response_due" type="date" /></Field>
        <Field label="Hearing date"><Input name="hearing_date" type="date" /></Field>
        <Field label="Tax demanded (₹)"><Input name="demand_tax" inputMode="decimal" /></Field>
        <Field label="Interest (₹)"><Input name="demand_interest" inputMode="decimal" /></Field>
        <Field label="Penalty (₹)"><Input name="demand_penalty" inputMode="decimal" /></Field>
        <Field label="Order date (for orders)"><Input name="order_date" type="date" /></Field>
        <Field label="Amount paid / pre-deposit (₹)"><Input name="amount_paid" inputMode="decimal" /></Field>
        <Field label="Notes" className="md:col-span-3"><Textarea name="notes" rows={1} /></Field>
      </div>
    </ActionForm>
  );
}
