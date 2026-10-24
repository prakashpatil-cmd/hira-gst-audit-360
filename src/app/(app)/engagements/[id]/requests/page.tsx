import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { DATASETS } from "@/lib/import/datasets";
import { Section, Stat } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { addRequestAction, updateRequestAction } from "../work-actions";

export default async function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const rows = await withUser(user.id, (tx) => tx`select r.*, (select json_agg(json_build_object('id', d.id, 'name', d.file_name)) from public.source_documents d where d.id = any(r.document_ids)) files
    from public.document_requests r where r.engagement_id = ${id}
    order by case r.status when 'requested' then 0 when 'uploaded' then 1 when 'rejected' then 2 else 3 end, r.priority, r.due_date nulls last, r.title`);
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((r) => ["requested", "rejected"].includes(r.status));
  const overdue = open.filter((r) => r.due_date && r.due_date < today);
  const manage = can(user, "requests.manage");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Requested items" value={rows.filter((r) => r.status !== "not_applicable").length} />
        <Stat label="Outstanding" value={open.length} tone={open.length ? "danger" : "good"} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
        <Stat label="Received, awaiting review" value={rows.filter((r) => r.status === "uploaded").length} />
      </div>
      <Section title="Information request list" description="Generated from the client's business profile. Client users see and answer these requests in the client portal.">
        <Table>
          <THead><TR><TH>Item</TH><TH>Category</TH><TH>Priority</TH><TH>Due</TH><TH>Files received</TH><TH>Status</TH><TH>Actions</TH></TR></THead>
          <TBody>{rows.length === 0 ? <Empty colSpan={7}>No requests.</Empty> : rows.map((r) => (
            <TR key={r.id}>
              <TD className="max-w-md"><div className="font-medium">{r.title}</div>{r.description ? <div className="text-xs text-muted-foreground">{r.description}</div> : null}
                {r.review_comment ? <div className="text-xs text-amber-700">Reviewer: {r.review_comment}</div> : null}
                {r.dataset_type && DATASETS.find((d) => d.type === r.dataset_type) ? <Link className="text-xs text-primary hover:underline" href={`/engagements/${id}/imports?dataset=${r.dataset_type}`}>Import as data →</Link> : null}</TD>
              <TD>{r.category ?? "—"}</TD><TD><Badge variant={r.priority === "high" ? "high" : "muted"}>{r.priority}</Badge></TD>
              <TD className={r.due_date && r.due_date < today && open.includes(r) ? "font-medium text-red-700" : ""}>{fmtDate(r.due_date)}{r.reminder_count ? <div className="text-xs text-muted-foreground">{r.reminder_count} reminder(s)</div> : null}</TD>
              <TD className="max-w-[220px] text-xs">{r.files ? (r.files as { id: string; name: string }[]).map((f) => <a key={f.id} className="block truncate text-primary hover:underline" href={`/api/files/${f.id}`}>{f.name}</a>) : "—"}</TD>
              <TD><StatusBadge status={r.status} /></TD>
              <TD className="space-y-1">
                {manage ? <>
                  <ActionForm action={updateRequestAction} inline className="flex-wrap">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="engagement_id" value={id} />
                    <Select name="op" className="h-8 w-32 text-xs" defaultValue={r.status === "uploaded" ? "accept" : "remind"}>
                      <option value="accept">Accept</option><option value="reject">Reject</option><option value="remind">Log reminder</option>
                      <option value="not_applicable">Not applicable</option><option value="reopen">Reopen</option></Select>
                    <Input name="review_comment" placeholder="Comment" className="h-8 w-32 text-xs" />
                    <button className="rounded border px-2 py-1 text-xs hover:bg-muted">Apply</button>
                  </ActionForm>
                  <ActionForm action={updateRequestAction} inline>
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="op" value="upload" />
                    <Input type="file" name="file" className="h-8 w-48 text-xs" /><button className="rounded border px-2 py-1 text-xs hover:bg-muted">Attach</button>
                  </ActionForm>
                </> : null}
              </TD>
            </TR>))}
          </TBody>
        </Table>
      </Section>
      {manage ? (
        <Section title="Add a request">
          <ActionForm action={addRequestAction} submitLabel="Add request" resetOnSuccess className="space-y-4 p-5">
            <input type="hidden" name="engagement_id" value={id} />
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Item requested" className="md:col-span-2"><Input name="title" required /></Field>
              <Field label="Category"><Input name="category" placeholder="ITC / Exports / RCM…" /></Field>
              <Field label="Priority"><Select name="priority" defaultValue="normal"><option>high</option><option>normal</option><option>low</option></Select></Field>
              <Field label="Details" className="md:col-span-2"><Input name="description" /></Field>
              <Field label="Due date"><Input name="due_date" type="date" /></Field>
              <Field label="Client contact"><Input name="assigned_contact" placeholder="name / email" /></Field>
              <Field label="Importable as"><Select name="dataset_type" defaultValue=""><option value="">— document only —</option>{DATASETS.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}</Select></Field>
            </div>
          </ActionForm>
        </Section>
      ) : null}
    </div>
  );
}
