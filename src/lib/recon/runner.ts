import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { serviceSql, withUser, type Sql } from "@/lib/db";
import { toPaise, paiseToDecimal } from "@/lib/gst/money";
import { normaliseDocNo } from "@/lib/gst/documents";
import { todayIso } from "@/lib/gst/dates";
import { enqueueJob, registerJobHandler, PermanentJobError, type JobRow } from "@/lib/jobs/queue";
import type { SessionUser } from "@/lib/auth/permissions";
import { ENGINE_VERSION } from "@/lib/rules/statutory";
import type { RDoc, MatchResult, Agg } from "./match";
import type { GstinData, LedgerRow, ReconContext, ReconOutput, ExceptionDraft } from "./types";
import { reconBooksVsGstr1, reconGstr1VsGstr3b, reconPrVs2bVs3b, reconEinvoice, reconEwayBills, reconImportExport, reconTrialBalance } from "./reconcilers";
import { runSpecialChecks } from "./checks";

export const RECON_TYPES = {
  BOOKS_GSTR1: { label: "Books vs GSTR-1", module: "B", needs: ["sales_register", "gstr1"] },
  GSTR1_GSTR3B: { label: "GSTR-1 vs GSTR-3B", module: "B", needs: ["gstr1", "gstr3b"] },
  PR_2B_3B: { label: "Purchase register vs GSTR-2B vs GSTR-3B", module: "C", needs: ["purchase_register", "gstr2b"] },
  EINV_GSTR1_BOOKS: { label: "E-invoice vs GSTR-1 vs books", module: "F", needs: ["einvoice_register", "gstr1"] },
  EWB_SALES: { label: "E-way bills vs sales", module: "G", needs: ["eway_bill_register", "sales_register"] },
  IMPORT_EXPORT: { label: "Imports and exports", module: "H", needs: [] },
  TB_RETURNS: { label: "Trial balance & ledgers vs returns", module: "N", needs: ["trial_balance"] },
  SPECIAL_CHECKS: { label: "Specialist checks (RCM, blocked ITC, credit notes, rates, fixed assets)", module: "D", needs: [] },
} as const;
export type ReconType = keyof typeof RECON_TYPES;

/** Exception type → control-library automation key. */
export const CHECK_KEY_BY_TYPE: Record<string, string> = {
  DUPLICATE_ITC: "DUP_ITC", DUPLICATE_IN_BOOKS: "DUP_SALES", ITC_TIME_BARRED: "ITC_TIME_BAR_16_4", BLOCKED_ITC_17_5: "BLOCKED_ITC_17_5",
  RCM_IMPORT_OF_SERVICES: "RCM_IMPORT_OF_SERVICES", RCM_NOTIFIED: "RCM_NOTIFIED", CN_TIME_LIMIT_34_2: "CN_TIME_LIMIT_34_2",
  CN_BEFORE_INVOICE: "CN_BEFORE_INVOICE", EWB_TAX_IN_CESS: "EWB_TAX_IN_CESS", SALE_WITHOUT_EWB: "EWB_MISSING",
  EWB_CANCELLED_DISCARDED: "EWB_CANCELLED_DISCARDED", GSTR1_WITHOUT_IRN: "EINV_MISSING_IRN", EXPORT_SB_MISSING: "EXPORT_SB_MISSING",
  EXPORT_96A_3M: "EXPORT_96A_3M", BOE_ITC_FTWZ: "BOE_ITC_FTWZ", BOE_NOT_IN_2B_IMPG: "BOE_NOT_IN_2B_IMPG", CASH_LEDGER_IDLE: "CASH_LEDGER_IDLE",
  WRONG_RATE: "WRONG_RATE", INVALID_GSTIN: "INVALID_GSTIN", WRONG_TAX_HEAD: "WRONG_TAX_HEAD", NEGATIVE_ITC_BALANCE: "NEGATIVE_ITC_BALANCE",
  FA_DISPOSAL: "FA_DISPOSAL",
};

const P = (v: unknown) => toPaise(v ?? 0);
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function doc(r: Row, over: Partial<RDoc> & { meta?: Record<string, unknown> } = {}): RDoc {
  return {
    id: r.source_transaction_id, docType: r.doc_type ?? "INV", docNo: r.doc_no ?? "", docNoNorm: r.doc_no_norm ?? "", docDate: r.doc_date ?? null,
    gstin: r.gstin ?? null, name: r.name ?? null, period: r.period ?? null, rate: r.rate == null ? null : Number(r.rate),
    taxable: P(r.taxable_value), igst: P(r.igst), cgst: P(r.cgst), sgst: P(r.sgst), cess: P(r.cess), ...over,
  };
}

export async function loadGstinData(sql: Sql, engagementId: string, gstinId: string | null): Promise<GstinData> {
  const g = gstinId ? sql`client_gstin_id = ${gstinId}` : sql`true`;
  const [gst] = gstinId ? await sql<{ gstin: string }[]>`select gstin from public.client_gstins where id = ${gstinId}` : [{ gstin: null as unknown as string }];
  const sales = await sql<Row[]>`select s.*, s.invoice_no doc_no, s.invoice_no_norm doc_no_norm, s.invoice_date doc_date, s.customer_gstin gstin, s.customer_name name
    from public.sales_invoices s where engagement_id = ${engagementId} and is_current and ${g}`;
  const notes = async (table: "credit_notes" | "debit_notes", side: string) => sql<Row[]>`
    select n.*, n.note_no doc_no, n.note_no_norm doc_no_norm, n.note_date doc_date, n.counterparty_gstin gstin, n.counterparty_name name
    from ${sql(`public.${table}`)} n where engagement_id = ${engagementId} and is_current and side = ${side} and ${g}`;
  const [cnOut, dnOut, cnIn, dnIn] = await Promise.all([notes("credit_notes", "outward"), notes("debit_notes", "outward"), notes("credit_notes", "inward"), notes("debit_notes", "inward")]);
  const purchases = await sql<Row[]>`select p.*, p.invoice_no doc_no, p.invoice_no_norm doc_no_norm, p.invoice_date doc_date, p.supplier_gstin gstin, p.supplier_name name,
      st.extra->>'reason' as description
    from public.purchase_invoices p join public.source_transactions st on st.id = p.source_transaction_id
    where p.engagement_id = ${engagementId} and p.is_current and ${gstinId ? sql`p.client_gstin_id = ${gstinId}` : sql`true`}`;
  const lines = await sql<Row[]>`select l.*, l.counterparty_gstin gstin, l.counterparty_name name, st.extra->>'reason' as reason
    from public.gst_return_lines l join public.source_transactions st on st.id = l.source_transaction_id
    where l.engagement_id = ${engagementId} and l.is_current and ${gstinId ? sql`l.client_gstin_id = ${gstinId}` : sql`true`}`;
  const einv = await sql<Row[]>`select e.*, e.buyer_gstin gstin from public.einvoices e where engagement_id = ${engagementId} and is_current and ${g}`;
  const ewb = await sql<Row[]>`select e.*, e.to_gstin gstin, e.ewb_date as period_date from public.eway_bills e where engagement_id = ${engagementId} and is_current and ${g}`;
  const boe = await sql<Row[]>`select * from public.bills_of_entry where engagement_id = ${engagementId} and is_current and ${g}`;
  const sb = await sql<Row[]>`select * from public.shipping_bills where engagement_id = ${engagementId} and is_current and ${g}`;
  const ledgers = await sql<Row[]>`select * from public.ledger_balances where engagement_id = ${engagementId} and is_current and ${g}`;
  const imports = await sql<{ id: string }[]>`select id from public.data_imports where engagement_id = ${engagementId} and status = 'committed' and ${g} order by id`;

  const itcMeta = (r: Row) => {
    const i = { itcIgst: P(r.itc_igst), itcCgst: P(r.itc_cgst), itcSgst: P(r.itc_sgst), itcCess: P(r.itc_cess) };
    return { ...i, itcTotal: i.itcIgst + i.itcCgst + i.itcSgst + i.itcCess };
  };
  const noteMeta = (r: Row) => ({ originalNo: r.original_invoice_no, originalNoNorm: r.original_invoice_no ? normaliseDocNo(r.original_invoice_no) : null,
    originalDate: r.original_invoice_date, reason: r.reason, hsn: r.hsn, source: "books", voucher: r.voucher_ref });

  return {
    gstinId, gstin: gst?.gstin ?? null,
    sales: sales.map((r) => doc(r, { meta: { supplyType: r.supply_type, irn: r.irn, ewbNo: r.eway_bill_no, sbNo: r.shipping_bill_no, hsn: r.hsn,
      invoiceValue: r.invoice_value == null ? null : P(r.invoice_value), pos: r.place_of_supply, source: "books", ledger: r.ledger_name } })),
    salesNotes: [...cnOut.map((r) => doc(r, { docType: "CRN", meta: noteMeta(r) })), ...dnOut.map((r) => doc(r, { docType: "DBN", meta: noteMeta(r) }))],
    purchases: purchases.map((r) => {
      const isBoe = r.doc_type === "BOE" || ((r.is_import || r.boe_no) && r.boe_no);
      return doc(r, {
        ...(isBoe ? { docType: "BOE", docNo: r.boe_no ?? r.doc_no, docNoNorm: normaliseDocNo(r.boe_no ?? r.doc_no), gstin: null } : {}),
        meta: { ...itcMeta(r), claimPeriod: r.itc_claim_period, category: r.itc_category, rcm: r.reverse_charge, isImport: r.is_import, boeNo: r.boe_no,
          boeNoNorm: r.boe_no ? normaliseDocNo(r.boe_no) : null, ledger: r.expense_ledger, hsn: r.hsn, description: r.description, voucher: r.voucher_ref, source: "purchase" },
      });
    }),
    purchaseNotes: [...cnIn.map((r) => doc(r, { docType: "CRN", meta: { ...noteMeta(r), itcTotal: P(r.igst) + P(r.cgst) + P(r.sgst) + P(r.cess), source: "purchase" } })),
      ...dnIn.map((r) => doc(r, { docType: "DBN", meta: { ...noteMeta(r), itcTotal: P(r.igst) + P(r.cgst) + P(r.sgst) + P(r.cess), source: "purchase" } }))],
    gstr1: lines.filter((l) => l.return_type === "GSTR1" || l.return_type === "GSTR1A").map((r) => doc(r, { meta: { table: r.table_code, sbNo: r.shipping_bill_no,
      sbDate: r.shipping_bill_date, portCode: r.port_code, pos: r.place_of_supply, source: "gstr1" } })),
    gstr3b: lines.filter((l) => l.return_type === "GSTR3B").map((r) => ({ id: r.source_transaction_id, period: r.period, table: r.table_code,
      taxable: P(r.taxable_value), igst: P(r.igst), cgst: P(r.cgst), sgst: P(r.sgst), cess: P(r.cess) })),
    gstr2b: lines.filter((l) => l.return_type === "GSTR2B").map((r) => doc(r, {
      ...(String(r.table_code).startsWith("IMPG") ? { docType: "BOE", gstin: null } : {}),
      meta: { table: r.table_code, itcAvailable: r.itc_available, rcm: r.reverse_charge, reason: r.reason, supplierFilingDate: r.supplier_filing_date, source: "gstr2b" } })),
    einv: einv.map((r) => doc(r, { meta: { status: r.irn_status, ackDate: r.ack_date ? new Date(r.ack_date).toISOString() : null, irn: r.irn } })),
    ewb: ewb.map((r) => doc(r, { period: r.ewb_date ? String(r.ewb_date).slice(0, 8) + "01" : null, meta: { ewbNo: r.ewb_no, status: r.ewb_status,
      direction: r.supply_direction, subType: r.sub_type, hsn: r.hsn, totalValue: r.total_value } })),
    boe: boe.map((r) => ({ id: r.source_transaction_id, boeNo: r.boe_no, boeNorm: normaliseDocNo(r.boe_no), boeDate: r.boe_date, igst: P(r.igst), cess: P(r.cess),
      assessable: P(r.assessable_value), type: r.boe_type, port: r.port_code, paidUnderProtest: r.paid_under_protest, hsn: r.hsn })),
    sb: sb.map((r) => ({ id: r.source_transaction_id, sbNo: r.sb_no, sbDate: r.sb_date, port: r.port_code, invoiceNo: r.invoice_no, invoiceNorm: r.invoice_no_norm,
      invoiceDate: r.invoice_date, fob: r.fob_value_inr == null ? null : P(r.fob_value_inr), leoDate: r.leo_date, icegateStatus: r.icegate_status, brcNo: r.brc_no })),
    ledgers: ledgers.map(ledgerRow),
    importIds: imports.map((i) => i.id),
  };
}

function ledgerRow(r: Row): LedgerRow {
  const extra = { ...(r.extra ?? {}) };
  if (extra.itc_availed != null) extra.itc_availed_paise = P(extra.itc_availed);
  return { id: r.source_transaction_id, source: r.source, name: r.ledger_name, group: r.ledger_group, taxHead: r.tax_head, period: r.period,
    opening: P(r.opening), debit: P(r.debit), credit: P(r.credit), closing: P(r.closing), extra };
}

async function contextFor(sql: Sql, engagementId: string, gstinId: string | null, params: Record<string, unknown>): Promise<ReconContext> {
  const [e] = await sql<Row[]>`select e.period_from, e.period_to, e.tolerance_amount, e.materiality_amount, c.aato_crore,
      (select einvoice_applicable_from from public.client_gstins where id = ${gstinId}) as einv_from
    from public.audit_engagements e join public.clients c on c.id = e.client_id where e.id = ${engagementId}`;
  return {
    asOf: String(params.asOf ?? todayIso()), periodFrom: e.period_from, periodTo: e.period_to,
    tolerance: P(params.tolerance ?? e.tolerance_amount), materiality: P(e.materiality_amount),
    einvoiceFrom: e.einv_from ?? null, aatoCrore: e.aato_crore == null ? null : Number(e.aato_crore),
    annualReturnFiledOn: (params.annualReturnFiledOn as string | undefined) ?? null,
  };
}

export async function queueRecon(user: SessionUser, engagementId: string, reconType: ReconType, params: Record<string, unknown> = {}): Promise<string> {
  if (!(reconType in RECON_TYPES)) throw new Error("Unknown reconciliation type");
  return withUser(user.id, async (tx) => {
    const [e] = await tx<{ organisation_id: string }[]>`select organisation_id from public.audit_engagements where id = ${engagementId}`;
    if (!e) throw new Error("Engagement not found");
    const [run] = await tx<{ id: string }[]>`insert into public.reconciliation_runs (organisation_id, engagement_id, recon_type, status, params, engine_version, created_by)
      values (${e.organisation_id}, ${engagementId}, ${reconType}, 'queued', ${tx.json(params as never)}, ${ENGINE_VERSION}, ${user.id}) returning id`;
    await enqueueJob(tx, { organisationId: e.organisation_id, engagementId, type: "recon.run", payload: { runId: run.id }, createdBy: user.id });
    return run.id;
  });
}

const dec = (a: Agg | null) => a ? { taxable: paiseToDecimal(a.taxable), igst: paiseToDecimal(a.igst), cgst: paiseToDecimal(a.cgst), sgst: paiseToDecimal(a.sgst),
  cess: paiseToDecimal(a.cess), tax: paiseToDecimal(a.tax), docNo: a.docNo, docDate: a.docDate, gstin: a.gstin, periods: a.periods, rates: a.rates, lines: a.ids.length } : null;

async function reconJob(job: JobRow, progress: (p: number, m?: string) => Promise<void>) {
  const sql = serviceSql();
  const runId = String(job.payload.runId);
  const [run] = await sql<Row[]>`select * from public.reconciliation_runs where id = ${runId}`;
  if (!run) throw new PermanentJobError("Run not found");
  const type = run.recon_type as ReconType;
  await sql`update public.reconciliation_runs set status = 'running', started_at = now(), error = null where id = ${runId}`;
  try {
    const gstins = await sql<{ id: string }[]>`select client_gstin_id as id from public.engagement_gstins where engagement_id = ${run.engagement_id} order by 1`;
    const results: { gstinId: string | null; out: ReconOutput }[] = [];
    const importIds = new Set<string>();
    if (type === "TB_RETURNS") {
      const all = await loadGstinData(sql, run.engagement_id, null);
      all.importIds.forEach((i) => importIds.add(i));
      results.push({ gstinId: null, out: reconTrialBalance(all, await contextFor(sql, run.engagement_id, null, run.params)) });
    } else {
      let n = 0;
      for (const g of gstins) {
        await progress(10 + (n++ / Math.max(1, gstins.length)) * 60, `Reconciling registration ${n} of ${gstins.length}`);
        const data = await loadGstinData(sql, run.engagement_id, g.id);
        data.importIds.forEach((i) => importIds.add(i));
        const ctx = await contextFor(sql, run.engagement_id, g.id, run.params);
        const fn = { BOOKS_GSTR1: reconBooksVsGstr1, GSTR1_GSTR3B: reconGstr1VsGstr3b, PR_2B_3B: reconPrVs2bVs3b, EINV_GSTR1_BOOKS: reconEinvoice,
          EWB_SALES: reconEwayBills, IMPORT_EXPORT: reconImportExport, SPECIAL_CHECKS: (d: GstinData, c: ReconContext) => runSpecialChecks(d, [], c) }[type];
        results.push({ gstinId: g.id, out: fn(data, ctx) });
      }
      if (type === "SPECIAL_CHECKS") {
        const entity = await loadGstinData(sql, run.engagement_id, null);
        const ledgersOnly: GstinData = { ...emptyData(), purchases: entity.purchases };
        results.push({ gstinId: null, out: runSpecialChecks(ledgersOnly, entity.ledgers.filter((l) => l.source !== "trial_balance"),
          await contextFor(sql, run.engagement_id, null, run.params)) });
      }
    }
    const inputHash = createHash("sha256").update(JSON.stringify({ type, imports: Array.from(importIds).sort(), params: run.params, ENGINE_VERSION })).digest("hex");
    await progress(75, "Saving results");
    const summary = await persist(sql, run, results);
    await sql`update public.reconciliation_runs set status = 'completed', completed_at = now(), input_hash = ${inputHash},
        input_import_ids = ${Array.from(importIds)}::uuid[], summary = ${sql.json(summary as never)} where id = ${runId}`;
    return summary;
  } catch (e) {
    await sql`update public.reconciliation_runs set status = 'failed', error = ${e instanceof Error ? e.message : String(e)}, completed_at = now() where id = ${runId}`;
    throw new PermanentJobError(e instanceof Error ? e.message : String(e));
  }
}

function emptyData(): GstinData {
  return { gstinId: null, gstin: null, sales: [], salesNotes: [], purchases: [], purchaseNotes: [], gstr1: [], gstr3b: [], gstr2b: [], einv: [], ewb: [], boe: [], sb: [], ledgers: [], importIds: [] };
}

const exKey = (e: { exception_type: string; doc_no: string | null; counterparty_gstin: string | null; period: string | null; client_gstin_id: string | null }) =>
  [e.exception_type, e.doc_no ?? "", e.counterparty_gstin ?? "", e.period ?? "", e.client_gstin_id ?? ""].join("|");

async function persist(sql: Sql, run: Row, results: { gstinId: string | null; out: ReconOutput }[]) {
  const controls = await sql<{ id: string; automation: Row }[]>`
    select distinct on (cv.control_id) cv.control_id as id, cv.automation from public.control_versions cv
    where cv.automation is not null and cv.status in ('approved','pending_approval','draft') order by cv.control_id, cv.version desc`;
  const controlFor = (type: string): string | null => {
    const key = CHECK_KEY_BY_TYPE[type];
    const c = key ? controls.find((x) => x.automation?.engine === "check" && x.automation?.key === key)
                  : controls.find((x) => x.automation?.engine === "recon" && x.automation?.type === run.recon_type);
    return c?.id ?? null;
  };
  return sql.begin(async (tx) => {
    // carry forward triage from the previous current run of the same type
    const prev = await tx<Row[]>`select e.* from public.reconciliation_exceptions e join public.reconciliation_runs r on r.id = e.run_id
      where r.engagement_id = ${run.engagement_id} and r.recon_type = ${run.recon_type} and r.is_current and r.id <> ${run.id}
        and (e.status <> 'open' or e.classification is not null or e.observation_id is not null or e.assigned_to is not null)`;
    const carry = new Map(prev.map((p) => [exKey(p as Parameters<typeof exKey>[0]), p]));
    await tx`update public.reconciliation_runs set is_current = false, status = case when status = 'completed' then 'superseded' else status end
      where engagement_id = ${run.engagement_id} and recon_type = ${run.recon_type} and id <> ${run.id}`;

    const counts: Record<string, number> = {};
    const exCounts: Record<string, number> = {};
    let exTotal = 0, carried = 0;
    const bySeverity: Record<string, number> = {};
    const gstinSummaries: Row[] = [];
    for (const { gstinId, out } of results) {
      const matchIds = out.matches.map(() => randomUUID());
      const mrows = out.matches.map((m: MatchResult, i) => ({
        id: matchIds[i], run_id: run.id, engagement_id: run.engagement_id, match_key: m.key.slice(0, 500), match_status: m.status, match_method: m.method,
        counterparty_gstin: m.left?.gstin ?? m.right?.gstin ?? null, doc_no: (m.left ?? m.right)?.docNo ?? null,
        doc_date: (m.left ?? m.right)?.docDate ?? null, period: (m.left?.periods ?? m.right?.periods ?? [])[0] ?? null,
        left_ids: m.left?.ids ?? [], right_ids: m.right?.ids ?? [], left_values: tx.json(dec(m.left) as never), right_values: tx.json(dec(m.right) as never),
        diff: tx.json({ ...Object.fromEntries(Object.entries(m.diff).map(([k, v]) => [k, paiseToDecimal(v)])), flags: m.flags } as never),
      }));
      for (const m of out.matches) counts[m.status] = (counts[m.status] ?? 0) + 1;
      for (let i = 0; i < mrows.length; i += 2000) {
        const chunk = mrows.slice(i, i + 2000);
        await tx`insert into public.reconciliation_matches ${tx(chunk, "id", "run_id", "engagement_id", "match_key", "match_status", "match_method",
          "counterparty_gstin", "doc_no", "doc_date", "period", "left_ids", "right_ids", "left_values", "right_values", "diff")}`;
      }
      const erows = out.exceptions.map((e: ExceptionDraft) => {
        const row = {
          organisation_id: run.organisation_id, run_id: run.id, engagement_id: run.engagement_id, client_gstin_id: gstinId, recon_type: run.recon_type,
          exception_type: e.type, module: e.module, control_id: e.controlId ?? controlFor(e.type), severity: e.severity,
          match_id: e.matchIndex != null ? matchIds[e.matchIndex] ?? null : null, doc_no: e.docNo ?? null, doc_date: e.docDate ?? null,
          counterparty_gstin: e.gstin ?? null, counterparty_name: e.name ?? null, period: e.period ?? null, description: e.description,
          diff_taxable: paiseToDecimal(e.diff.taxable), diff_igst: paiseToDecimal(e.diff.igst), diff_cgst: paiseToDecimal(e.diff.cgst),
          diff_sgst: paiseToDecimal(e.diff.sgst), diff_cess: paiseToDecimal(e.diff.cess), diff_tax: paiseToDecimal(e.diff.tax),
          source_ids: e.sourceIds, status: "open", classification: e.classification as string | null, assigned_to: null as string | null,
          observation_id: null as string | null, resolution_note: null as string | null,
        };
        const p = carry.get(exKey({ exception_type: row.exception_type, doc_no: row.doc_no, counterparty_gstin: row.counterparty_gstin, period: row.period, client_gstin_id: gstinId }));
        if (p) { row.status = p.status; row.classification = p.classification ?? row.classification; row.assigned_to = p.assigned_to;
          row.observation_id = p.observation_id; row.resolution_note = p.resolution_note; carried++; }
        exCounts[e.type] = (exCounts[e.type] ?? 0) + 1;
        bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
        return row;
      });
      exTotal += erows.length;
      for (let i = 0; i < erows.length; i += 1000) await tx`insert into public.reconciliation_exceptions ${tx(erows.slice(i, i + 1000))}`;
      gstinSummaries.push({ gstinId, ...out.summary });
    }

    // Update the control checklist for automated controls touched by this run
    const touched = new Set<string>();
    const recControl = controls.find((x) => x.automation?.engine === "recon" && x.automation?.type === run.recon_type);
    if (recControl) touched.add(recControl.id);
    for (const t of Object.keys(exCounts)) { const c = controlFor(t); if (c) touched.add(c); }
    if (run.recon_type === "SPECIAL_CHECKS") for (const c of controls) if (c.automation?.engine === "check") touched.add(c.id);
    const exByControl = await tx<{ control_id: string; n: number }[]>`select control_id, count(*)::int n from public.reconciliation_exceptions
      where run_id = ${run.id} and control_id is not null group by control_id`;
    const exMap = new Map(exByControl.map((r) => [r.control_id, r.n]));
    for (const cid of touched) {
      const n = exMap.get(cid) ?? 0;
      const work = `Automated ${RECON_TYPES[run.recon_type as ReconType].label} (run ${String(run.id).slice(0, 8)}, engine ${ENGINE_VERSION}): ${n} exception(s) raised.`;
      await tx`insert into public.audit_test_results (organisation_id, engagement_id, control_id, control_version_id, status, work_performed, exceptions_count, tested_by, tested_at)
        select ${run.organisation_id}, ${run.engagement_id}, cv.control_id, cv.id, ${n ? "exception_detected" : "passed"}, ${work}, ${n}, ${run.created_by}, now()
        from public.control_versions cv where cv.control_id = ${cid} order by cv.version desc limit 1
        on conflict (engagement_id, control_id) where client_gstin_id is null do update set
          status = case when audit_test_results.status in ('not_started','data_awaited','in_progress','passed','exception_detected') then excluded.status else audit_test_results.status end,
          work_performed = excluded.work_performed, exceptions_count = excluded.exceptions_count, tested_by = excluded.tested_by, tested_at = now()`;
    }
    return { matchCounts: counts, exceptionCounts: exCounts, exceptions: exTotal, bySeverity, carriedForward: carried, registrations: gstinSummaries };
  });
}

registerJobHandler("recon.run", reconJob);
