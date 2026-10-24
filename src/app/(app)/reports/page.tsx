import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { fmtDateTime } from "@/lib/gst/dates";
import { PageHeader, Section } from "@/components/app/page-header";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Report archive" };

export default async function ReportArchive({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status = "" } = await searchParams;
  const rows = await withUser(user.id, (tx) => tx`select r.id, r.engagement_id, r.version, r.label, r.status, r.generated_at, r.approved_at, r.pdf_document_id, r.xlsx_document_id, r.snapshot_hash,
      jsonb_array_length(coalesce(r.snapshot->'observations','[]'::jsonb)) obs, e.engagement_code, e.financial_year, c.legal_name, a.full_name approver
    from public.report_versions r join public.audit_engagements e on e.id = r.engagement_id join public.clients c on c.id = e.client_id
    left join public.users a on a.id = r.approved_by where ${status ? tx`r.status = ${status}` : tx`true`} order by coalesce(r.approved_at, r.generated_at, r.created_at) desc limit 500`);
  return (
    <>
      <PageHeader title="Report archive" description="Every report version with its frozen snapshot hash, PDF and Excel annexures. Downloads are recorded in the audit log." />
      <Section title="Reports" actions={<form className="flex gap-2"><Select name="status" defaultValue={status} className="h-8 w-44 text-xs"><option value="">All statuses</option>
        {["draft", "pending_approval", "approved", "issued", "superseded"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select><Button size="sm" variant="outline">Filter</Button></form>}>
        <Table><THead><TR><TH>Client</TH><TH>Engagement</TH><TH>Version</TH><TH>Status</TH><TH className="text-right">Observations</TH><TH>Generated</TH><TH>Approved</TH><TH>Files</TH></TR></THead>
          <TBody>{rows.length === 0 ? <Empty colSpan={8}>No reports yet.</Empty> : rows.map((r) => (
            <TR key={r.id}><TD>{r.legal_name}</TD><TD><Link className="text-hira-800 hover:underline" href={`/engagements/${r.engagement_id}/reports`}>{r.engagement_code}</Link><div className="text-xs text-muted-foreground">FY {r.financial_year}</div></TD>
              <TD>v{r.version} <Badge variant={r.label === "FINAL" ? "default" : "medium"}>{r.label}</Badge></TD><TD><StatusBadge status={r.status} /></TD><TD className="num">{r.obs}</TD>
              <TD className="text-xs">{fmtDateTime(r.generated_at)}</TD><TD className="text-xs">{r.approver ? `${r.approver}, ${fmtDateTime(r.approved_at)}` : "—"}</TD>
              <TD className="text-xs">{r.pdf_document_id ? <a className="block text-primary hover:underline" href={`/api/files/${r.pdf_document_id}`}>PDF</a> : null}
                {r.xlsx_document_id ? <a className="block text-primary hover:underline" href={`/api/files/${r.xlsx_document_id}`}>Annexures</a> : null}
                <span className="font-mono text-[10px] text-muted-foreground">{r.snapshot_hash?.slice(0, 12)}</span></TD></TR>))}</TBody></Table>
      </Section>
    </>
  );
}
