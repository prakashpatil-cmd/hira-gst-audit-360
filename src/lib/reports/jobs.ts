import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { serviceSql } from "@/lib/db";
import { objectStore } from "@/lib/storage";
import { registerJobHandler, PermanentJobError, type JobRow } from "@/lib/jobs/queue";
import { renderReportPdf } from "./pdf";
import { buildAnnexures } from "./xlsx";
import type { ReportSnapshot } from "./snapshot";

/** Generates the PDF report and Excel annexures for a report version from its frozen snapshot. */
async function generateReportJob(job: JobRow, progress: (p: number, m?: string) => Promise<void>) {
  const sql = serviceSql();
  const versionId = String(job.payload.versionId);
  const [v] = await sql`select r.*, e.client_id, e.organisation_id org, u.full_name approver from public.report_versions r
    join public.audit_engagements e on e.id = r.engagement_id left join public.users u on u.id = r.approved_by where r.id = ${versionId}`;
  if (!v || !v.snapshot) throw new PermanentJobError("Report version or snapshot not found");
  const snap = v.snapshot as ReportSnapshot;
  await progress(15, "Rendering PDF");
  const pdf = await renderReportPdf(snap, v.label, v.approver, v.approved_at ? new Date(v.approved_at).toISOString() : null);
  await progress(60, "Building Excel annexures");
  const xlsx = await buildAnnexures(sql, v.engagement_id, snap);
  await progress(85, "Storing files");
  const safe = snap.engagement.clientName.replace(/[^\w]+/g, "_").slice(0, 40);
  const base = `GST_Health_Check_${safe}_${snap.engagement.code}_v${v.version}_${v.label}`;
  const store = async (body: Buffer, name: string, mime: string, kind: "report" | "annexure") => {
    const id = randomUUID();
    const key = `${v.org}/${v.client_id}/${v.engagement_id}/${kind}/${id}-${name}`;
    await objectStore().put(key, body, mime);
    await sql`insert into public.source_documents (id, organisation_id, client_id, engagement_id, kind, storage_path, file_name, mime_type, size_bytes, sha256, scan_status, uploaded_by, description)
      values (${id}, ${v.org}, ${v.client_id}, ${v.engagement_id}, ${kind}, ${key}, ${name}, ${mime}, ${body.length},
              ${createHash("sha256").update(body).digest("hex")}, 'clean', ${job.created_by}, ${`Report v${v.version} ${v.label}`})`;
    return id;
  };
  const pdfId = await store(pdf, `${base}.pdf`, "application/pdf", "report");
  const xlsxId = await store(xlsx, `${base}_Annexures.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "annexure");
  await sql`update public.report_versions set pdf_document_id = ${pdfId}, xlsx_document_id = ${xlsxId}, generated_at = now(), generated_by = ${job.created_by} where id = ${versionId}`;
  return { pdfId, xlsxId, pages: null, bytes: pdf.length };
}

registerJobHandler("report.generate", generateReportJob);
