import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { getDataset } from "@/lib/import/datasets";
import { previewImport } from "@/lib/import/service";
import type { QualityReport } from "@/lib/import/service";
import { inr } from "@/lib/gst/money";
import { fmtPeriod, fmtDateTime } from "@/lib/gst/dates";
import { Section, Stat, Pager } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { JobWatcher } from "@/components/app/job-watcher";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { saveMappingAction, validateImportAction, commitImportAction, discardImportAction } from "../actions";

const PAGE = 50;

export default async function ImportDetail({ params, searchParams }: { params: Promise<{ id: string; importId: string }>; searchParams: Promise<{ rows?: string; page?: string }> }) {
  const user = await requireUser();
  const { id, importId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const rowFilter = sp.rows ?? "";
  const data = await withUser(user.id, async (tx) => {
    const [imp] = await tx`select i.*, d.file_name, d.sha256, d.size_bytes, g.gstin from public.data_imports i join public.source_documents d on d.id = i.source_document_id
      left join public.client_gstins g on g.id = i.client_gstin_id where i.id = ${importId} and i.engagement_id = ${id}`;
    if (!imp) return null;
    const jobs = await tx`select id, job_type from public.jobs where payload->>'importId' = ${importId} and status in ('queued','running')`;
    const where = rowFilter ? tx`and row_status = ${rowFilter}` : tx``;
    const rows = await tx`select row_number, row_status, issues, doc_type, doc_no, doc_date, counterparty_gstin, taxable_value, igst, cgst, sgst, cess, period
      from public.source_transactions where import_id = ${importId} ${where} order by row_number limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.source_transactions where import_id = ${importId} ${where}`;
    return { imp, jobs, rows, n };
  });
  if (!data) notFound();
  const { imp, jobs } = data;
  const dataset = getDataset(imp.dataset_type);
  const editable = can(user, "imports.manage") && ["uploaded", "mapped", "validated", "failed"].includes(imp.status);
  const preview = editable && imp.status !== "validated" ? await previewImport(user, importId, 8).catch((e) => ({ error: String(e.message ?? e) })) : null;
  const qr = imp.quality_report as QualityReport | null;
  const map = (imp.column_map ?? {}) as Record<string, string>;
  const headers: string[] = imp.detected_headers ?? [];
  const opts = imp.options ?? {};
  const base = `/engagements/${id}/imports/${importId}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/engagements/${id}/imports`} className="text-xs text-muted-foreground hover:underline">← All imports</Link>
          <h2 className="text-lg font-semibold text-hira-800">{dataset.label} · version {imp.version}</h2>
          <p className="text-sm text-muted-foreground">{imp.file_name} · {imp.gstin ?? "entity level"} · SHA-256 <span className="font-mono text-xs">{imp.sha256.slice(0, 16)}…</span> · uploaded {fmtDateTime(imp.created_at)}</p>
        </div>
        <StatusBadge status={imp.status} />
      </div>
      {jobs.map((j) => <JobWatcher key={j.id} jobId={j.id} label={j.job_type === "import.commit" ? "Committing" : "Validating"} />)}
      {imp.error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{imp.error}</p> : null}

      {editable ? (
        <Section title="1. Column mapping" description={`Map the file's columns to the ${dataset.label} fields. Required fields are marked *. Save a template to reuse it for this client.`}>
          <ActionForm action={saveMappingAction} submitLabel="Save mapping" className="space-y-4 p-5">
            <input type="hidden" name="import_id" value={importId} /><input type="hidden" name="engagement_id" value={id} />
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
              {dataset.fields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  <Select name={`map:${f.key}`} defaultValue={map[f.key] ?? ""} className={f.required && !map[f.key] ? "border-red-400" : ""}>
                    <option value="">— not in file —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="grid gap-3 border-t pt-4 md:grid-cols-3 lg:grid-cols-6">
              <Field label="Worksheet"><Input name="sheet" defaultValue={imp.sheet_name ?? ""} placeholder="first sheet" /></Field>
              <Field label="Header row"><Input name="header_row" type="number" min={1} defaultValue={imp.header_row} /></Field>
              <Field label="Date format"><Select name="date_order" defaultValue={opts.dateOrder ?? "DMY"}><option value="DMY">DD/MM/YYYY</option><option value="MDY">MM/DD/YYYY</option><option value="YMD">YYYY-MM-DD</option></Select></Field>
              <Field label="Default return period" hint="If the file has no period column"><Input name="default_period" type="month" defaultValue={opts.defaultPeriod?.slice(0, 7) ?? ""} /></Field>
              <Field label="On commit"><Select name="mode" defaultValue={opts.mode ?? "replace"}><option value="replace">Replace earlier version</option><option value="append">Append (skip duplicates)</option></Select></Field>
              <Field label="Save as template"><Input name="template_name" placeholder="e.g. Tally sales export" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="negative_cn" defaultChecked={!!opts.negativeAsCreditNote} className="h-4 w-4" />Treat negative-value invoices as credit notes</label>
          </ActionForm>
        </Section>
      ) : null}

      {preview && "rows" in preview ? (
        <Section title="Preview" description="First rows of the file as they will be interpreted with the saved mapping.">
          <Table>
            <THead><TR><TH>Row</TH><TH>Result</TH><TH>Document</TH><TH>Date</TH><TH>GSTIN</TH><TH className="text-right">Taxable</TH><TH className="text-right">Tax</TH><TH>Issues</TH></TR></THead>
            <TBody>{preview.rows.map((r) => {
              const c = r.result.common;
              const tax = [c.igst, c.cgst, c.sgst, c.cess].reduce((s, v) => s + Number(v ?? 0), 0);
              return (
                <TR key={r.rowNumber}><TD>{r.rowNumber}</TD><TD><StatusBadge status={r.result.status} /></TD><TD>{c.doc_type} {c.doc_no ?? String(r.result.extra.ewb_no ?? r.result.extra.table_code ?? r.result.extra.ledger_name ?? "")}</TD>
                  <TD>{c.doc_date ?? c.period ?? "—"}</TD><TD className="font-mono text-xs">{c.counterparty_gstin ?? "—"}</TD><TD className="num">{inr(c.taxable_value)}</TD><TD className="num">{inr(tax)}</TD>
                  <TD className="text-xs">{r.result.issues.map((i, k) => <div key={k} className={i.severity === "error" ? "text-red-700" : i.severity === "warning" ? "text-amber-700" : "text-muted-foreground"}>{i.message}</div>)}</TD></TR>
              );
            })}</TBody>
          </Table>
        </Section>
      ) : preview && "error" in preview ? <p className="text-sm text-destructive">{preview.error}</p> : null}

      {editable ? (
        <div className="flex flex-wrap gap-3">
          <ActionForm action={validateImportAction} inline submitLabel={imp.status === "validated" ? "Re-validate" : "2. Validate all rows"} pendingText="Validating…">
            <input type="hidden" name="import_id" value={importId} /><input type="hidden" name="engagement_id" value={id} />
          </ActionForm>
          {imp.status === "validated" ? (
            <ActionForm action={commitImportAction} inline submitLabel="3. Commit to audit data" pendingText="Committing…"
              confirm={opts.mode === "append" ? "Append accepted rows to the engagement data?" : "Commit and supersede any earlier version of this record type for this GSTIN?"}>
              <input type="hidden" name="import_id" value={importId} /><input type="hidden" name="engagement_id" value={id} />
            </ActionForm>
          ) : null}
          <ActionForm action={discardImportAction} inline submitLabel="Discard" submitVariant="ghost" confirm="Discard this upload? The original file is retained for the audit trail.">
            <input type="hidden" name="import_id" value={importId} /><input type="hidden" name="engagement_id" value={id} />
          </ActionForm>
        </div>
      ) : null}

      {qr ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Rows read" value={imp.total_rows} href={base} />
            <Stat label="Accepted" value={imp.accepted_rows} href={`${base}?rows=accepted`} tone="good" />
            <Stat label="Accepted with warnings" value={imp.warning_rows} href={`${base}?rows=warning`} />
            <Stat label="Rejected" value={imp.rejected_rows} href={`${base}?rows=rejected`} tone={imp.rejected_rows ? "danger" : undefined} />
            <Stat label="Duplicates" value={imp.duplicate_rows} href={`${base}?rows=duplicate`} />
          </div>
          <Section title="Import quality report" description="Rejected and duplicate rows are retained and are not committed. Warnings are committed and flagged.">
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Issues found</p>
                {qr.unmappedRequired?.length ? <p className="mb-2 text-sm text-red-700">Required fields not mapped: {qr.unmappedRequired.join(", ")}</p> : null}
                {qr.overlap ? <p className="mb-2 text-sm text-amber-700">{qr.overlap}</p> : null}
                {qr.notes.map((n, i) => <p key={i} className="mb-2 text-sm text-muted-foreground">{n}</p>)}
                <Table><THead><TR><TH>Issue</TH><TH>Severity</TH><TH className="text-right">Rows</TH><TH>Example rows</TH></TR></THead>
                  <TBody>{qr.issues.length === 0 ? <Empty colSpan={4}>No issues.</Empty> : qr.issues.map((i) => (
                    <TR key={i.code + i.severity}><TD><div className="font-medium">{i.code.replace(/_/g, " ")}</div><div className="text-xs text-muted-foreground">{i.message}</div></TD>
                      <TD><Badge variant={i.severity === "error" ? "high" : i.severity === "warning" ? "medium" : "muted"}>{i.severity}</Badge></TD>
                      <TD className="num">{i.count}</TD><TD className="text-xs">{i.sampleRows.join(", ")}</TD></TR>))}</TBody></Table>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Accepted totals by period</p>
                <Table><THead><TR><TH>Period</TH><TH className="text-right">Rows</TH><TH className="text-right">Taxable value</TH><TH className="text-right">Tax</TH></TR></THead>
                  <TBody>{qr.byPeriod.map((p) => <TR key={p.period ?? "na"}><TD>{fmtPeriod(p.period)}</TD><TD className="num">{p.rows}</TD><TD className="num">{inr(p.taxable)}</TD><TD className="num">{inr(p.tax)}</TD></TR>)}
                    <TR className="font-semibold"><TD>Total</TD><TD /><TD className="num">{inr(qr.totals.taxable)}</TD>
                      <TD className="num">{inr(Number(qr.totals.igst) + Number(qr.totals.cgst) + Number(qr.totals.sgst) + Number(qr.totals.cess))}</TD></TR></TBody></Table>
              </div>
            </div>
          </Section>
        </>
      ) : null}

      <Section title={`Source rows${rowFilter ? ` — ${rowFilter}` : ""}`} description="Every row of the uploaded file with its original row number and the issues found.">
        <Table>
          <THead><TR><TH>Row</TH><TH>Status</TH><TH>Type</TH><TH>Document</TH><TH>Date</TH><TH>Counterparty</TH><TH>Period</TH><TH className="text-right">Taxable</TH><TH className="text-right">IGST</TH><TH className="text-right">CGST</TH><TH className="text-right">SGST</TH><TH className="text-right">Cess</TH><TH>Issues</TH></TR></THead>
          <TBody>{data.rows.length === 0 ? <Empty colSpan={13}>No rows {imp.status === "mapped" ? "yet — validate the import" : "in this view"}.</Empty> : data.rows.map((r) => (
            <TR key={r.row_number}><TD>{r.row_number}</TD><TD><StatusBadge status={r.row_status} /></TD><TD>{r.doc_type ?? "—"}</TD><TD>{r.doc_no ?? "—"}</TD><TD>{r.doc_date ?? "—"}</TD>
              <TD className="font-mono text-xs">{r.counterparty_gstin ?? "—"}</TD><TD>{fmtPeriod(r.period)}</TD><TD className="num">{inr(r.taxable_value)}</TD><TD className="num">{inr(r.igst)}</TD>
              <TD className="num">{inr(r.cgst)}</TD><TD className="num">{inr(r.sgst)}</TD><TD className="num">{inr(r.cess)}</TD>
              <TD className="max-w-xs text-xs">{(r.issues as { message: string; severity: string }[]).map((i, k) => <div key={k} className={i.severity === "error" ? "text-red-700" : i.severity === "warning" ? "text-amber-700" : "text-muted-foreground"}>{i.message}</div>)}</TD></TR>))}
          </TBody>
        </Table>
        <Pager page={page} pageSize={PAGE} total={data.n} href={(p) => `${base}?page=${p}${rowFilter ? `&rows=${rowFilter}` : ""}`} />
      </Section>
    </div>
  );
}
