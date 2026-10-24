import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { serviceSql, withUser, type Tx, type Sql } from "@/lib/db";
import { objectStore, inspectUpload, scanForMalware, safeFileName } from "@/lib/storage";
import type { SessionUser } from "@/lib/auth/permissions";
import { enqueueJob, registerJobHandler, PermanentJobError, type JobRow } from "@/lib/jobs/queue";
import { toPaise } from "@/lib/gst/money";
import { getDataset, autoMap, type DatasetDef } from "./datasets";
import { parseFile, type Cell } from "./parse";
import { normaliseRow, markDuplicates, type ImportOptions, type NormalisedRow } from "./normalise";

export interface ImportRecord {
  id: string; organisation_id: string; engagement_id: string; client_gstin_id: string | null; dataset_type: string;
  source_document_id: string; status: string; sheet_name: string | null; header_row: number; column_map: Record<string, string> | null;
  options: ImportOptions & { mode?: "replace" | "append" }; detected_headers: string[] | null; version: number;
  storage_path: string; file_name: string; client_id: string; gstin: string | null; period_from: string; period_to: string;
  tolerance_amount: string; sha256: string;
}

async function loadImport(sql: Sql | Tx, importId: string): Promise<ImportRecord> {
  const [r] = await sql<ImportRecord[]>`
    select i.*, d.storage_path, d.file_name, d.client_id, d.sha256, g.gstin, e.period_from, e.period_to, e.tolerance_amount
    from public.data_imports i
    join public.source_documents d on d.id = i.source_document_id
    join public.audit_engagements e on e.id = i.engagement_id
    left join public.client_gstins g on g.id = i.client_gstin_id
    where i.id = ${importId}`;
  if (!r) throw new PermanentJobError("Import not found");
  return r;
}

/** Stores an uploaded file privately and records it (RLS-checked insert). */
export async function storeDocument(tx: Tx, user: SessionUser, a: { clientId: string; engagementId: string | null;
  kind: string; fileName: string; body: Buffer; description?: string; preUploadedKey?: string }): Promise<{ id: string; sha256: string; mime: string }> {
  const check = inspectUpload(a.fileName, a.body);
  if (!check.ok) {
    if (a.preUploadedKey) await objectStore().remove(a.preUploadedKey);
    throw new Error(check.reason);
  }
  const scan = await scanForMalware(a.body);
  if (scan === "infected") {
    if (a.preUploadedKey) await objectStore().remove(a.preUploadedKey);
    throw new Error("The file failed the malware scan and was not stored.");
  }
  const sha = createHash("sha256").update(a.body).digest("hex");
  const id = randomUUID();
  const prefix = `${user.orgId}/${a.clientId}/${a.engagementId ?? "client"}/`;
  if (a.preUploadedKey && !a.preUploadedKey.startsWith(`${prefix}staging/`)) throw new Error("Upload key does not belong to this engagement");
  const key = a.preUploadedKey ?? `${prefix}${a.kind}/${id}-${safeFileName(a.fileName)}`;
  await tx`insert into public.source_documents (id, organisation_id, client_id, engagement_id, kind, storage_path, file_name, mime_type,
      size_bytes, sha256, scan_status, description, uploaded_by)
    values (${id}, ${user.orgId}, ${a.clientId}, ${a.engagementId}, ${a.kind}, ${key}, ${a.fileName}, ${check.mime},
      ${a.body.length}, ${sha}, ${scan}, ${a.description ?? null}, ${user.id})`;
  if (!a.preUploadedKey) await objectStore().put(key, a.body, check.mime);   // after the RLS-checked insert succeeded
  return { id, sha256: sha, mime: check.mime };
}

export async function createImport(user: SessionUser, a: { engagementId: string; clientGstinId: string | null; datasetType: string;
  fileName: string; body: Buffer; preUploadedKey?: string }): Promise<string> {
  const dataset = getDataset(a.datasetType);
  if (dataset.perGstin && !a.clientGstinId) throw new Error(`${dataset.label} must be imported against a GSTIN`);
  const table = await parseFile(a.fileName, a.body, { maxRows: 50 });   // header detection only
  return withUser(user.id, async (tx) => {
    const [eng] = await tx<{ client_id: string; organisation_id: string }[]>`
      select client_id, organisation_id from public.audit_engagements where id = ${a.engagementId}`;
    if (!eng) throw new Error("Engagement not found or not accessible");
    if (a.clientGstinId) {
      const [ok] = await tx`select 1 from public.engagement_gstins where engagement_id = ${a.engagementId} and client_gstin_id = ${a.clientGstinId}`;
      if (!ok) throw new Error("This GSTIN is not part of the engagement scope");
    }
    const doc = await storeDocument(tx, user, { clientId: eng.client_id, engagementId: a.engagementId, kind: "import_file", fileName: a.fileName, body: a.body,
      preUploadedKey: a.preUploadedKey });
    // Prefer the client's saved mapping template whose columns are all present in this file.
    const templates = await tx<{ id: string; column_map: Record<string, string>; sheet_name: string | null; header_row: number; options: ImportOptions }[]>`
      select id, column_map, sheet_name, header_row, options from public.import_mappings
      where dataset_type = ${a.datasetType} and (client_id = ${eng.client_id} or client_id is null)
      order by (client_id is null), created_at desc`;
    const tpl = templates.find((t) => Object.values(t.column_map).every((h) => table.headers.includes(h)));
    const columnMap = tpl?.column_map ?? autoMap(dataset, table.headers);
    const [{ v }] = await tx<{ v: number }[]>`select coalesce(max(version), 0) + 1 as v from public.data_imports
      where engagement_id = ${a.engagementId} and dataset_type = ${a.datasetType} and client_gstin_id is not distinct from ${a.clientGstinId}`;
    const [imp] = await tx<{ id: string }[]>`
      insert into public.data_imports (organisation_id, engagement_id, client_gstin_id, dataset_type, source_document_id, mapping_id,
        version, status, sheet_name, header_row, column_map, options, detected_headers, created_by)
      values (${eng.organisation_id}, ${a.engagementId}, ${a.clientGstinId}, ${a.datasetType}, ${doc.id}, ${tpl?.id ?? null}, ${v}, 'mapped',
        ${table.sheet}, ${table.headerRow || 1}, ${tx.json(columnMap)}, ${tx.json((tpl?.options ?? { mode: "replace" }) as never)},
        ${table.headers}, ${user.id})
      returning id`;
    return imp.id;
  });
}

export async function updateMapping(user: SessionUser, importId: string, a: { sheet?: string | null; headerRow?: number;
  columnMap: Record<string, string>; options: ImportOptions & { mode?: "replace" | "append" }; saveTemplateAs?: string | null }) {
  const imp = await loadImport(serviceSql(), importId);
  const file = await objectStore().get(imp.storage_path);
  const table = await parseFile(imp.file_name, file, { sheet: a.sheet ?? imp.sheet_name, headerRow: a.headerRow, maxRows: 5 });
  const cleanMap = Object.fromEntries(Object.entries(a.columnMap).filter(([, h]) => h && table.headers.includes(h)));
  await withUser(user.id, async (tx) => {
    const res = await tx`update public.data_imports set sheet_name = ${table.sheet}, header_row = ${table.headerRow || 1},
        column_map = ${tx.json(cleanMap)}, options = ${tx.json(a.options as never)}, detected_headers = ${table.headers}, status = 'mapped'
      where id = ${importId} and status in ('uploaded','mapped','validated','failed')`;
    if (res.count === 0) throw new Error("Import cannot be re-mapped in its current status");
    if (a.saveTemplateAs) {
      await tx`insert into public.import_mappings (organisation_id, client_id, dataset_type, name, sheet_name, header_row, column_map, options, created_by)
        values (${imp.organisation_id}, ${imp.client_id}, ${imp.dataset_type}, ${a.saveTemplateAs}, ${table.sheet}, ${table.headerRow || 1},
                ${tx.json(cleanMap)}, ${tx.json(a.options as never)}, ${user.id})
        on conflict (organisation_id, client_id, dataset_type, name) do update set column_map = excluded.column_map,
          sheet_name = excluded.sheet_name, header_row = excluded.header_row, options = excluded.options`;
    }
  });
}

export async function previewImport(user: SessionUser, importId: string, n = 25) {
  // RLS check first
  const visible = await withUser(user.id, (tx) => tx`select id from public.data_imports where id = ${importId}`);
  if (visible.length === 0) throw new Error("Import not found");
  const imp = await loadImport(serviceSql(), importId);
  const dataset = getDataset(imp.dataset_type);
  const file = await objectStore().get(imp.storage_path);
  const table = await parseFile(imp.file_name, file, { sheet: imp.sheet_name, headerRow: imp.header_row, maxRows: n });
  const ctx = contextFor(imp, dataset);
  return {
    sheets: table.sheets, sheet: table.sheet, headers: table.headers, headerRow: table.headerRow,
    rows: table.rows.map((r) => ({ rowNumber: r.rowNumber, raw: r.values, result: normaliseRow(r.values, ctx) })),
  };
}

function contextFor(imp: ImportRecord, dataset: DatasetDef) {
  return {
    dataset, columnMap: imp.column_map ?? {}, options: imp.options ?? {}, ourGstin: imp.gstin,
    periodFrom: imp.period_from, periodTo: imp.period_to, tolerancePaise: toPaise(imp.tolerance_amount),
  };
}

export async function queueValidation(user: SessionUser, importId: string): Promise<string> {
  return withUser(user.id, async (tx) => {
    const [imp] = await tx<{ organisation_id: string; engagement_id: string; status: string }[]>`
      select organisation_id, engagement_id, status from public.data_imports where id = ${importId}`;
    if (!imp) throw new Error("Import not found");
    if (!["mapped", "validated", "failed"].includes(imp.status)) throw new Error(`Import is ${imp.status}`);
    await tx`update public.data_imports set status = 'validating', error = null where id = ${importId}`;
    return enqueueJob(tx, { organisationId: imp.organisation_id, engagementId: imp.engagement_id, type: "import.validate",
      payload: { importId }, createdBy: user.id });
  });
}

export async function queueCommit(user: SessionUser, importId: string): Promise<string> {
  return withUser(user.id, async (tx) => {
    const [imp] = await tx<{ organisation_id: string; engagement_id: string; status: string; accepted_rows: number; warning_rows: number }[]>`
      select organisation_id, engagement_id, status, accepted_rows, warning_rows from public.data_imports where id = ${importId}`;
    if (!imp) throw new Error("Import not found");
    if (imp.status !== "validated") throw new Error("Only a validated import can be committed");
    if (imp.accepted_rows + imp.warning_rows === 0) throw new Error("No valid rows to commit");
    await tx`update public.data_imports set status = 'committing' where id = ${importId}`;
    return enqueueJob(tx, { organisationId: imp.organisation_id, engagementId: imp.engagement_id, type: "import.commit",
      payload: { importId }, createdBy: user.id, idempotencyKey: `commit:${importId}` });
  });
}

// ---------------------------------------------------------------------------
// Job: validate — parse whole file, normalise, detect duplicates, persist every row.
// Re-running is idempotent: rows for the import are replaced.
// ---------------------------------------------------------------------------
async function validateJob(job: JobRow, progress: (p: number, m?: string) => Promise<void>) {
  const sql = serviceSql();
  const importId = String(job.payload.importId);
  const imp = await loadImport(sql, importId);
  try {
    const dataset = getDataset(imp.dataset_type);
    await progress(5, "Reading file");
    const file = await objectStore().get(imp.storage_path);
    const table = await parseFile(imp.file_name, file, { sheet: imp.sheet_name, headerRow: imp.header_row });
    const ctx = contextFor(imp, dataset);
    const missingRequired = dataset.fields.filter((f) => f.required && !ctx.columnMap[f.key]).map((f) => f.label);
    await progress(15, `Validating ${table.rows.length} rows`);
    const results: NormalisedRow[] = table.rows.map((r) => normaliseRow(r.values, ctx));

    let existing = new Set<string>();
    if (imp.options?.mode === "append" && dataset.documentLevel) {
      const rows = await sql<{ fingerprint: string }[]>`
        select st.fingerprint from public.source_transactions st join public.data_imports di on di.id = st.import_id
        where di.engagement_id = ${imp.engagement_id} and di.dataset_type = ${imp.dataset_type} and di.status = 'committed'
          and di.client_gstin_id is not distinct from ${imp.client_gstin_id} and st.row_status in ('accepted','warning')
          and st.fingerprint is not null`;
      existing = new Set(rows.map((r) => r.fingerprint));
    }
    markDuplicates(results, existing, table.rows.map((r) => r.rowNumber));

    const [overlap] = await sql<{ version: number }[]>`
      select di.version from public.data_imports di join public.source_documents d on d.id = di.source_document_id
      where di.engagement_id = ${imp.engagement_id} and di.dataset_type = ${imp.dataset_type} and d.sha256 = ${imp.sha256}
        and di.id <> ${importId} and di.status = 'committed' limit 1`;

    await sql.begin(async (tx) => {
      await tx`delete from public.source_transactions where import_id = ${importId}`;
      const BATCH = 1000;
      for (let i = 0; i < results.length; i += BATCH) {
        const chunk = results.slice(i, i + BATCH).map((r, j) => {
          const src = table.rows[i + j];
          return {
            organisation_id: imp.organisation_id, engagement_id: imp.engagement_id, import_id: importId, client_gstin_id: imp.client_gstin_id,
            dataset_type: imp.dataset_type, row_number: src.rowNumber, raw: tx.json(jsonSafe(src.values) as never), row_status: r.status,
            issues: tx.json(r.issues as never), ...r.common, extra: tx.json(r.extra as never), fingerprint: r.fingerprint,
          };
        });
        await tx`insert into public.source_transactions ${tx(chunk)}`;
        await progress(15 + Math.round(((i + chunk.length) / Math.max(1, results.length)) * 75), `Saved ${i + chunk.length} rows`);
      }
    });

    const report = await qualityReport(sql, importId);
    if (missingRequired.length) report.unmappedRequired = missingRequired;
    if (overlap) report.overlap = `An identical file was already committed as version ${overlap.version}`;
    if (dataset.target === "purchase" && !["itc_igst", "itc_cgst", "itc_sgst"].some((k) => ctx.columnMap[k])) {
      report.notes.push("No ITC columns were mapped: ITC claimed will be treated as equal to tax charged on accepted rows.");
    }
    const c = report.byStatus;
    await sql`update public.data_imports set status = 'validated', validated_at = now(), total_rows = ${results.length},
        accepted_rows = ${c.accepted ?? 0}, warning_rows = ${c.warning ?? 0}, rejected_rows = ${c.rejected ?? 0}, duplicate_rows = ${c.duplicate ?? 0},
        quality_report = ${sql.json(report as never)}, error = null,
        processing_log = processing_log || ${sql.json([{ at: new Date().toISOString(), event: "validated", rows: results.length }] as never)}
      where id = ${importId}`;
    return { rows: results.length, ...c };
  } catch (e) {
    await sql`update public.data_imports set status = 'failed', error = ${e instanceof Error ? e.message : String(e)} where id = ${importId}`;
    throw new PermanentJobError(e instanceof Error ? e.message : String(e));
  }
}

function jsonSafe(values: Record<string, Cell>) {
  const o: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(values)) o[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  return o;
}

export interface QualityReport {
  byStatus: Record<string, number>;
  issues: { code: string; severity: string; count: number; sampleRows: number[]; message: string }[];
  totals: { taxable: string; igst: string; cgst: string; sgst: string; cess: string };
  byPeriod: { period: string | null; rows: number; taxable: string; tax: string }[];
  unmappedRequired?: string[];
  overlap?: string;
  notes: string[];
}

async function qualityReport(sql: Sql, importId: string): Promise<QualityReport> {
  const status = await sql<{ row_status: string; n: number }[]>`
    select row_status, count(*)::int as n from public.source_transactions where import_id = ${importId} group by row_status`;
  const issues = await sql<{ code: string; severity: string; count: number; sample_rows: number[]; message: string }[]>`
    select i->>'code' as code, i->>'severity' as severity, count(*)::int as count,
           (array_agg(st.row_number order by st.row_number))[1:10] as sample_rows, min(i->>'message') as message
    from public.source_transactions st, jsonb_array_elements(st.issues) i
    where st.import_id = ${importId} group by 1, 2 order by case i->>'severity' when 'error' then 0 when 'warning' then 1 else 2 end, 3 desc`;
  const [t] = await sql<{ taxable: string; igst: string; cgst: string; sgst: string; cess: string }[]>`
    select coalesce(sum(taxable_value),0)::text taxable, coalesce(sum(igst),0)::text igst, coalesce(sum(cgst),0)::text cgst,
           coalesce(sum(sgst),0)::text sgst, coalesce(sum(cess),0)::text cess
    from public.source_transactions where import_id = ${importId} and row_status in ('accepted','warning')`;
  const byPeriod = await sql<{ period: string | null; rows: number; taxable: string; tax: string }[]>`
    select period, count(*)::int rows, coalesce(sum(taxable_value),0)::text taxable,
           coalesce(sum(coalesce(igst,0)+coalesce(cgst,0)+coalesce(sgst,0)+coalesce(cess,0)),0)::text tax
    from public.source_transactions where import_id = ${importId} and row_status in ('accepted','warning')
    group by period order by period nulls last`;
  return {
    byStatus: Object.fromEntries(status.map((s) => [s.row_status, s.n])),
    issues: issues.map((i) => ({ code: i.code, severity: i.severity, count: i.count, sampleRows: i.sample_rows, message: i.message })),
    totals: t, byPeriod, notes: [],
  };
}

// ---------------------------------------------------------------------------
// Job: commit — materialise accepted rows into the typed tables in one transaction.
// ---------------------------------------------------------------------------
const TYPED_TABLES = ["sales_invoices", "purchase_invoices", "credit_notes", "debit_notes", "gst_return_lines", "gst_returns",
  "einvoices", "eway_bills", "bills_of_entry", "shipping_bills", "ledger_balances"] as const;

async function commitJob(job: JobRow, progress: (p: number, m?: string) => Promise<void>) {
  const sql = serviceSql();
  const importId = String(job.payload.importId);
  const imp = await loadImport(sql, importId);
  if (imp.status === "committed") return { alreadyCommitted: true };
  const dataset = getDataset(imp.dataset_type);
  const mode = imp.options?.mode ?? "replace";
  const itcMapped = ["itc_igst", "itc_cgst", "itc_sgst"].some((k) => imp.column_map?.[k]);
  await progress(10, "Committing");
  const counts = await sql.begin(async (tx) => {
    if (mode === "replace") {
      const prev = await tx<{ id: string }[]>`update public.data_imports set status = 'superseded'
        where engagement_id = ${imp.engagement_id} and dataset_type = ${imp.dataset_type} and status = 'committed'
          and client_gstin_id is not distinct from ${imp.client_gstin_id} and id <> ${importId} returning id`;
      const ids = prev.map((p) => p.id);
      if (ids.length) {
        for (const t of TYPED_TABLES) {
          if (t === "gst_return_lines") await tx`update public.gst_return_lines set is_current = false
            where gst_return_id in (select id from public.gst_returns where import_id = any(${ids}::uuid[]))`;
          else await tx`update ${tx(`public.${t}`)} set is_current = false where import_id = any(${ids}::uuid[])`;
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = tx`from public.source_transactions st where st.import_id = ${importId} and st.row_status in ('accepted','warning')`;
    const x = (k: string) => tx`(st.extra->>${k})`;
    let n = 0;
    switch (dataset.target) {
      case "sales": {
        n += (await tx`insert into public.sales_invoices (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id,
            doc_type, supply_type, invoice_no, invoice_no_norm, invoice_date, customer_gstin, customer_name, place_of_supply, hsn, rate,
            taxable_value, igst, cgst, sgst, cess, invoice_value, reverse_charge, irn, eway_bill_no, shipping_bill_no, shipping_bill_date,
            port_code, voucher_ref, ledger_name, period)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, coalesce(st.doc_type,'INV'), ${x("supply_type")},
            st.doc_no, st.doc_no_norm, st.doc_date, st.counterparty_gstin, st.counterparty_name, st.place_of_supply, st.hsn, st.rate,
            coalesce(st.taxable_value,0), coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0), st.total_value,
            coalesce(st.reverse_charge,false), ${x("irn")}, ${x("eway_bill_no")}, ${x("shipping_bill_no")}, ${x("shipping_bill_date")}::date,
            ${x("port_code")}, st.voucher_ref, st.ledger_name, st.period
          ${base} and coalesce(st.doc_type,'INV') not in ('CRN','DBN')`).count;
        n += await notes(tx, base, "outward");
        break;
      }
      case "purchase": {
        n += (await tx`insert into public.purchase_invoices (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id,
            doc_type, invoice_no, invoice_no_norm, invoice_date, supplier_gstin, supplier_name, place_of_supply, hsn, rate, taxable_value,
            igst, cgst, sgst, cess, invoice_value, itc_igst, itc_cgst, itc_sgst, itc_cess, itc_claim_period, itc_category, reverse_charge,
            is_import, boe_no, expense_ledger, voucher_ref, period)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, coalesce(st.doc_type,'INV'), st.doc_no, st.doc_no_norm,
            st.doc_date, st.counterparty_gstin, st.counterparty_name, st.place_of_supply, st.hsn, st.rate, coalesce(st.taxable_value,0),
            coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0), st.total_value,
            ${itcMapped ? tx`coalesce(${x("itc_igst")}::numeric,0), coalesce(${x("itc_cgst")}::numeric,0), coalesce(${x("itc_sgst")}::numeric,0), coalesce(${x("itc_cess")}::numeric,0)`
                        : tx`coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0)`},
            coalesce(${x("itc_claim_period")}::date, st.period), ${x("itc_category")}, coalesce(st.reverse_charge,false),
            coalesce(${x("is_import")}::boolean, false), ${x("boe_no")}, st.ledger_name, st.voucher_ref, st.period
          ${base} and coalesce(st.doc_type,'INV') not in ('CRN','DBN')`).count;
        n += await notes(tx, base, "inward");
        break;
      }
      case "gst_return": {
        const returns = await tx<{ id: string; period: string }[]>`
          insert into public.gst_returns (organisation_id, engagement_id, client_gstin_id, import_id, return_type, period, filing_date, arn)
          select ${imp.organisation_id}, ${imp.engagement_id}, ${imp.client_gstin_id}, ${importId}, ${dataset.returnType!}, st.period,
                 max(${x("filing_date")})::date, max(${x("arn")})
          ${base} and st.period is not null group by st.period returning id, period`;
        n += returns.length;
        n += (await tx`insert into public.gst_return_lines (organisation_id, engagement_id, gst_return_id, client_gstin_id, source_transaction_id,
            return_type, period, table_code, doc_type, doc_no, doc_no_norm, doc_date, counterparty_gstin, counterparty_name, place_of_supply,
            rate, taxable_value, igst, cgst, sgst, cess, reverse_charge, itc_available, shipping_bill_no, shipping_bill_date, port_code,
            supplier_filing_date)
          select st.organisation_id, st.engagement_id, r.id, st.client_gstin_id, st.id, ${dataset.returnType!}, st.period,
            coalesce(${x("table_code")}, ''), st.doc_type, st.doc_no, st.doc_no_norm, st.doc_date, st.counterparty_gstin, st.counterparty_name,
            st.place_of_supply, st.rate, coalesce(st.taxable_value,0), coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0),
            coalesce(st.cess,0), coalesce(st.reverse_charge,false), ${x("itc_available")}::boolean, ${x("shipping_bill_no")},
            ${x("shipping_bill_date")}::date, ${x("port_code")}, ${x("supplier_filing_date")}::date
          from public.source_transactions st join public.gst_returns r on r.import_id = st.import_id and r.period = st.period
          where st.import_id = ${importId} and st.row_status in ('accepted','warning')`).count;
        break;
      }
      case "einvoice":
        n += (await tx`insert into public.einvoices (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, irn, ack_no,
            ack_date, irn_status, cancel_date, doc_type, doc_no, doc_no_norm, doc_date, buyer_gstin, dispatch_from, ship_to, taxable_value, igst, cgst, sgst, cess)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${x("irn")}, ${x("ack_no")}, ${x("ack_date")}::timestamptz,
            case when upper(coalesce(${x("irn_status")},'ACT')) like 'C%' then 'CNL' else 'ACT' end, ${x("cancel_date")}::timestamptz,
            coalesce(st.doc_type,'INV'), st.doc_no, st.doc_no_norm, st.doc_date, st.counterparty_gstin, ${x("dispatch_from")}, ${x("ship_to")},
            coalesce(st.taxable_value,0), coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0)
          ${base}`).count;
        break;
      case "eway":
        n += (await tx`insert into public.eway_bills (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, ewb_no, ewb_date,
            ewb_status, supply_direction, sub_type, doc_type, doc_no, doc_no_norm, doc_date, from_gstin, to_gstin, from_pincode, to_pincode,
            distance_km, vehicle_no, valid_upto, hsn, taxable_value, igst, cgst, sgst, cess, total_value)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${x("ewb_no")}, ${x("ewb_date")}::date,
            case when lower(coalesce(${x("ewb_status")},'')) like 'cancel%' then 'cancelled' when lower(coalesce(${x("ewb_status")},'')) like 'discard%' then 'discarded'
                 when lower(coalesce(${x("ewb_status")},'')) like 'expire%' then 'expired' when lower(coalesce(${x("ewb_status")},'')) like 'reject%' then 'rejected' else 'active' end,
            case when lower(coalesce(${x("supply_direction")},'outward')) like 'in%' then 'inward' else 'outward' end, ${x("sub_type")},
            coalesce(st.doc_type,'INV'), st.doc_no, st.doc_no_norm, st.doc_date, coalesce(${x("from_gstin")}, st.our_gstin), st.counterparty_gstin,
            ${x("from_pincode")}, ${x("to_pincode")}, ${x("distance_km")}::int, ${x("vehicle_no")}, ${x("valid_upto")}::timestamptz, st.hsn,
            coalesce(st.taxable_value,0), coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0), st.total_value
          ${base}`).count;
        break;
      case "boe":
        n += (await tx`insert into public.bills_of_entry (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, boe_no, boe_date,
            port_code, boe_type, supplier_name, hsn, assessable_value, bcd, sws, igst, cess, is_amended, paid_under_protest)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${x("boe_no")}, ${x("boe_date")}::date, ${x("port_code")},
            ${x("boe_type")}, st.counterparty_name, st.hsn, coalesce(${x("assessable_value")}::numeric,0), coalesce(${x("bcd")}::numeric,0),
            coalesce(${x("sws")}::numeric,0), coalesce(st.igst,0), coalesce(st.cess,0), coalesce(${x("is_amended")}::boolean,false),
            coalesce(${x("paid_under_protest")}::boolean,false)
          ${base}`).count;
        break;
      case "shipping_bill":
        n += (await tx`insert into public.shipping_bills (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, sb_no, sb_date,
            port_code, invoice_no, invoice_no_norm, invoice_date, fob_value_inr, igst_paid, leo_date, egm_no, egm_date, icegate_status, brc_no, brc_date, realised_amount_inr)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${x("sb_no")}, ${x("sb_date")}::date, ${x("port_code")},
            ${x("invoice_no")}, st.doc_no_norm,
            ${x("invoice_date")}::date, ${x("fob_value_inr")}::numeric, coalesce(${x("igst_paid")}::numeric,0), ${x("leo_date")}::date, ${x("egm_no")},
            ${x("egm_date")}::date, ${x("icegate_status")}, ${x("brc_no")}, ${x("brc_date")}::date, ${x("realised_amount_inr")}::numeric
          ${base}`).count;
        break;
      case "ledger":
        n += (await tx`insert into public.ledger_balances (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, source,
            ledger_name, ledger_group, tax_head, period, opening, debit, credit, closing, extra)
          select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${dataset.ledgerSource!},
            coalesce(st.ledger_name, ${x("tax_head")}, 'Unnamed'), ${x("ledger_group")}, ${x("tax_head")}, coalesce(st.period, date_trunc('month', st.doc_date)::date),
            coalesce(${x("opening")}::numeric,0), coalesce(${x("debit")}::numeric,0), coalesce(${x("credit")}::numeric,0),
            coalesce(${x("closing")}::numeric,0),
            jsonb_strip_nulls(st.extra || jsonb_build_object('voucher_ref', st.voucher_ref, 'doc_date', st.doc_date, 'party', st.counterparty_name))
          ${base}`).count;
        break;
      case "evidence_only":
        break;
    }
    await tx`update public.data_imports set status = 'committed', committed_at = now(), committed_by = ${job.created_by},
        processing_log = processing_log || ${tx.json([{ at: new Date().toISOString(), event: "committed", records: n, mode }] as never)}
      where id = ${importId}`;
    return n;
  });
  return { committedRecords: counts };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notes(tx: Tx, base: any, side: "outward" | "inward"): Promise<number> {
  let n = 0;
  for (const [table, docType] of [["credit_notes", "CRN"], ["debit_notes", "DBN"]] as const) {
    n += (await tx`insert into ${tx(`public.${table}`)} (organisation_id, engagement_id, client_gstin_id, import_id, source_transaction_id, side,
        note_no, note_no_norm, note_date, original_invoice_no, original_invoice_date, counterparty_gstin, counterparty_name, reason, hsn, rate,
        taxable_value, igst, cgst, sgst, cess, voucher_ref, period)
      select st.organisation_id, st.engagement_id, st.client_gstin_id, st.import_id, st.id, ${side}, st.doc_no, st.doc_no_norm, st.doc_date,
        st.extra->>'original_doc_no', (st.extra->>'original_doc_date')::date, st.counterparty_gstin, st.counterparty_name, st.extra->>'reason',
        st.hsn, st.rate, coalesce(st.taxable_value,0), coalesce(st.igst,0), coalesce(st.cgst,0), coalesce(st.sgst,0), coalesce(st.cess,0),
        st.voucher_ref, st.period
      ${base} and st.doc_type = ${docType}`).count;
  }
  return n;
}

registerJobHandler("import.validate", validateJob);
registerJobHandler("import.commit", commitJob);
