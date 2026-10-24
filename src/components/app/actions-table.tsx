import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { inr } from "@/lib/gst/money";
import { fmtDate, todayIso } from "@/lib/gst/dates";
import { updateActionItemAction } from "@/app/(app)/engagements/[id]/observations/actions";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Corrective action tracker rows with inline status update and completion evidence. */
export function ActionsTable({ rows, showEngagement, canVerify, portal }: { rows: Row[]; showEngagement?: boolean; canVerify?: boolean; portal?: boolean }) {
  const today = todayIso();
  return (
    <Table>
      <THead><TR><TH>P</TH><TH>Action</TH>{showEngagement ? <TH>Client / engagement</TH> : null}<TH>Obs.</TH><TH>Owner</TH><TH>Due</TH><TH>Statutory deadline</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH>Update</TH></TR></THead>
      <TBody>{rows.length === 0 ? <Empty colSpan={10}>No corrective actions.</Empty> : rows.map((a) => {
        const overdue = a.due_date && a.due_date < today && !["completed", "verified", "cancelled"].includes(a.status);
        return (
          <TR key={a.id}>
            <TD className="font-semibold">{a.priority}</TD>
            <TD className="max-w-md"><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">{a.compliance_step}{a.completion_note ? ` · ${a.completion_note}` : ""}</div></TD>
            {showEngagement ? <TD className="text-xs">{a.legal_name}<div><Link className="text-primary hover:underline" href={`/engagements/${a.engagement_id}/actions`}>{a.engagement_code}</Link></div></TD> : null}
            <TD>{a.obs_number && !portal ? <Link className="text-primary hover:underline" href={`/engagements/${a.engagement_id}/observations/${a.observation_id}`}>{a.obs_number}</Link> : a.obs_number ?? "—"}</TD>
            <TD className="text-xs">{a.owner_name ?? "—"}</TD>
            <TD className={overdue ? "font-medium text-red-700" : ""}>{fmtDate(a.due_date)}{overdue ? <div className="text-xs">Overdue</div> : null}</TD>
            <TD>{fmtDate(a.statutory_deadline)}</TD>
            <TD className="num">{a.amount ? `₹${inr(a.amount, { decimals: 0 })}` : a.amount_label ?? "—"}</TD>
            <TD><StatusBadge status={a.status} /></TD>
            <TD>
              <ActionForm action={updateActionItemAction} inline className="flex-wrap">
                <input type="hidden" name="id" value={a.id} /><input type="hidden" name="engagement_id" value={a.engagement_id} />
                <Select name="status" defaultValue={a.status} className="h-8 w-28 text-xs">
                  {["open", "in_progress", "completed", ...(canVerify ? ["verified", "cancelled"] : [])].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
                <Input name="completion_note" placeholder="Evidence / note" className="h-8 w-32 text-xs" />
                <Input type="file" name="file" className="h-8 w-36 text-xs" />
                <button className="rounded border px-2 py-1 text-xs hover:bg-muted">Save</button>
              </ActionForm>
            </TD>
          </TR>
        );
      })}</TBody>
    </Table>
  );
}
