import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { getEngagement } from "@/lib/queries";
import { DATASETS, DATASET_MAP } from "@/lib/import/datasets";
import { fmtDateTime } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { UploadForm } from "@/components/app/upload-form";
import { JobWatcher } from "@/components/app/job-watcher";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { uploadImportAction, prepareUploadAction } from "./actions";

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dataset?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { dataset } = await searchParams;
  const e = await getEngagement(user, id);
  const { imports, jobs } = await withUser(user.id, async (tx) => ({
    imports: await tx`select i.*, d.file_name, d.size_bytes, d.scan_status, g.gstin, u.full_name
      from public.data_imports i join public.source_documents d on d.id = i.source_document_id
      left join public.client_gstins g on g.id = i.client_gstin_id left join public.users u on u.id = i.created_by
      where i.engagement_id = ${id} and i.status <> 'discarded' order by i.created_at desc`,
    jobs: await tx`select id, job_type from public.jobs where engagement_id = ${id} and job_type like 'import.%' and status in ('queued','running')`,
  }));
  const committed = new Set(imports.filter((i) => i.status === "committed").map((i) => `${i.dataset_type}|${i.gstin ?? ""}`));
  const core = ["sales_register", "purchase_register", "gstr1", "gstr3b", "gstr2b", "eway_bill_register", "einvoice_register"];
  return (
    <div className="space-y-6">
      {jobs.map((j) => <JobWatcher key={j.id} jobId={j.id} label={j.job_type === "import.commit" ? "Committing import" : "Validating import"} />)}
      {can(user, "imports.manage") ? (
        <Section title="Upload records" description="Files are stored privately with their SHA-256 hash; every row is kept with its source row number. Nothing is discarded silently.">
          <div className="p-5">
            <UploadForm engagementId={id} gstins={e.gstins} defaultDataset={dataset}
              datasets={DATASETS.map((d) => ({ type: d.type, label: d.label, group: d.group, perGstin: d.perGstin }))}
              action={uploadImportAction} prepare={prepareUploadAction} />
          </div>
        </Section>
      ) : null}
      <Section title="Core data coverage" description="Committed datasets per registration (needed for the automated reconciliations).">
        <Table>
          <THead><TR><TH>GSTIN</TH>{core.map((c) => <TH key={c} className="text-center">{DATASET_MAP.get(c)!.label.replace(/ \((books|portal)\)/, "")}</TH>)}</TR></THead>
          <TBody>{e.gstins.map((g) => (
            <TR key={g.id}><TD className="font-mono text-xs">{g.gstin}</TD>
              {core.map((c) => <TD key={c} className="text-center">{committed.has(`${c}|${g.gstin}`) ? <span className="text-hira-700">●</span> : <span className="text-muted-foreground">○</span>}</TD>)}
            </TR>))}
          </TBody>
        </Table>
      </Section>
      <Section title="Import history" description="Each upload is versioned; a committed replace-mode import supersedes the previous version for the same record type and GSTIN.">
        <Table>
          <THead><TR><TH>Record type</TH><TH>GSTIN</TH><TH>File</TH><TH className="text-right">Ver.</TH><TH className="text-right">Rows</TH><TH className="text-right">Accepted</TH><TH className="text-right">Warnings</TH><TH className="text-right">Rejected</TH><TH className="text-right">Duplicates</TH><TH>Uploaded</TH><TH>Status</TH></TR></THead>
          <TBody>
            {imports.length === 0 ? <Empty colSpan={11}>No files uploaded yet.</Empty> : imports.map((i) => (
              <TR key={i.id}>
                <TD><Link className="font-medium text-hira-800 hover:underline" href={`/engagements/${id}/imports/${i.id}`}>{DATASET_MAP.get(i.dataset_type)?.label ?? i.dataset_type}</Link></TD>
                <TD className="font-mono text-xs">{i.gstin ?? "Entity"}</TD>
                <TD className="max-w-[220px] truncate text-xs" title={i.file_name}>{i.file_name}<div className="text-muted-foreground">{(Number(i.size_bytes) / 1024).toFixed(0)} KB · scan {i.scan_status}</div></TD>
                <TD className="num">{i.version}</TD><TD className="num">{i.total_rows}</TD><TD className="num">{i.accepted_rows}</TD><TD className="num">{i.warning_rows}</TD>
                <TD className="num">{i.rejected_rows ? <span className="text-red-700">{i.rejected_rows}</span> : 0}</TD><TD className="num">{i.duplicate_rows}</TD>
                <TD className="text-xs">{fmtDateTime(i.created_at)}<div className="text-muted-foreground">{i.full_name}</div></TD>
                <TD><StatusBadge status={i.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </div>
  );
}
