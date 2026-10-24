import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { serviceSql, withUser } from "@/lib/db";
import { makeGstin } from "@/lib/gst/gstin";
import { createImport, queueValidation, queueCommit } from "@/lib/import/service";
import { queueRecon, RECON_TYPES, type ReconType } from "@/lib/recon/runner";
import { createObservationFromExceptions } from "@/lib/observations";
import { buildReportSnapshot } from "@/lib/reports/snapshot";
import { renderReportPdf } from "@/lib/reports/pdf";
import { buildAnnexures } from "@/lib/reports/xlsx";
import { setupEngagementProgramme } from "@/lib/engagements";
import ExcelJS from "exceljs";
import { drainJobs, makeUser, resetDb } from "../support/fixtures";

const DIR = path.resolve("samples/demo");
const PAN = "AABCH2468K";
let ctx: { orgId: string; engagementId: string; mh: string; wb: string; user: Awaited<ReturnType<typeof makeUser>>; mgr: Awaited<ReturnType<typeof makeUser>> };

async function load(file: string, dataset: string, gstinId: string | null) {
  const id = await createImport(ctx.user, { engagementId: ctx.engagementId, clientGstinId: gstinId, datasetType: dataset, fileName: file, body: fs.readFileSync(path.join(DIR, file)) });
  await queueValidation(ctx.user, id); await drainJobs();
  const sql = serviceSql();
  const [imp] = await sql`select status, total_rows, accepted_rows, warning_rows, rejected_rows, column_map, quality_report, error from public.data_imports where id = ${id}`;
  expect(imp.status, `${file}: ${imp.error ?? JSON.stringify(imp.quality_report?.unmappedRequired)}`).toBe("validated");
  await queueCommit(ctx.user, id); await drainJobs();
  return imp;
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(DIR, "01_sales_register_MH.xlsx"))) throw new Error("Run `npm run demo:data` first");
  await resetDb();
  const sql = serviceSql();
  const [org] = await sql<{ id: string }[]>`insert into public.organisations (name, slug) values ('HIRA Associates', 'hira-demo') returning id`;
  // load the control library so automated controls are linked
  const controls = JSON.parse(fs.readFileSync("db/seed/controls.json", "utf8")) as { id: string; module: string; category: string; title: string; objective: string; procedure: string; automation: unknown; expected_result: string; exception_conditions: string; risk_level: string; corrective_action: string; law_refs: string[] }[];
  for (const c of controls) {
    await sql`insert into public.audit_controls (id, module, category, title) values (${c.id}, ${c.module}, ${c.category}, ${c.title})`;
    await sql`insert into public.control_versions (control_id, version, objective, procedure, automation, expected_result, exception_conditions, risk_level, corrective_action, law_refs, status)
      values (${c.id}, 1, ${c.objective}, ${c.procedure}, ${c.automation ? sql.json(c.automation as never) : null}, ${c.expected_result}, ${c.exception_conditions}, ${c.risk_level}, ${c.corrective_action}, ${c.law_refs}, 'approved')`;
  }
  const [client] = await sql<{ id: string }[]>`insert into public.clients (organisation_id, legal_name, pan, is_exporter, is_importer, einvoice_applicable, aato_crore)
    values (${org.id}, 'Helix Diagnostics Manufacturing Private Limited', ${PAN}, true, true, true, 120) returning id`;
  const g = async (st: string) => (await sql<{ id: string }[]>`insert into public.client_gstins (organisation_id, client_id, gstin, state_code, einvoice_applicable_from)
    values (${org.id}, ${client.id}, ${makeGstin(st, PAN)}, ${st}, '2023-08-01') returning id`)[0].id;
  const mh = await g("27"), ka = await g("29"), wb = await g("19");
  const [e] = await sql<{ id: string }[]>`insert into public.audit_engagements (organisation_id, client_id, engagement_code, title, financial_year, period_from, period_to, materiality_amount)
    values (${org.id}, ${client.id}, 'HGA-DEMO-1', 'GST Health Check', '2026-27', '2026-04-01', '2026-06-30', 10000) returning id`;
  for (const x of [mh, ka, wb]) await sql`insert into public.engagement_gstins values (${e.id}, ${x})`;
  const user = await makeUser(org.id, "auditor@hira.test", "gst_auditor");
  const mgr = await makeUser(org.id, "manager@hira.test", "audit_manager");
  await sql`insert into public.audit_assignments (engagement_id, user_id, engagement_role) values (${e.id}, ${user.id}, 'auditor'), (${e.id}, ${mgr.id}, 'manager')`;
  ctx = { orgId: org.id, engagementId: e.id, mh, wb, user, mgr };
  await withUser(mgr.id, (tx) => setupEngagementProgramme(tx, e.id, mgr.id));
}, 300_000);

describe("Demo dataset end-to-end through the engine", () => {
  it("imports every demo file with automatic column mapping", async () => {
    const s = await load("01_sales_register_MH.xlsx", "sales_register", ctx.mh);
    expect(s.accepted_rows + s.warning_rows).toBeGreaterThan(40);
    await load("02_gstr1_MH.csv", "gstr1", ctx.mh);
    await load("03_gstr3b_MH.csv", "gstr3b", ctx.mh);
    await load("04_purchase_register_MH.csv", "purchase_register", ctx.mh);
    for (const f of fs.readdirSync(DIR).filter((f) => f.startsWith("05_gstr2b"))) {
      const id = await createImport(ctx.user, { engagementId: ctx.engagementId, clientGstinId: ctx.mh, datasetType: "gstr2b", fileName: f, body: fs.readFileSync(path.join(DIR, f)) });
      await withUser(ctx.user.id, (tx) => tx`update public.data_imports set options = options || '{"mode":"append"}' where id = ${id}`);
      await queueValidation(ctx.user, id); await drainJobs(); await queueCommit(ctx.user, id); await drainJobs();
    }
    await load("06_eway_bills_MH.csv", "eway_bill_register", ctx.mh);
    await load("07_einvoice_register_MH.csv", "einvoice_register", ctx.mh);
    await load("08_shipping_bills_MH.csv", "shipping_bills", ctx.mh);
    await load("09_bills_of_entry_MH.csv", "bills_of_entry", ctx.mh);
    await load("10_general_ledger.csv", "general_ledger", null);
    await load("11_trial_balance.csv", "trial_balance", null);
    await load("12_electronic_cash_ledger_WB.csv", "electronic_cash_ledger", ctx.wb);
    await load("13_fixed_asset_register.csv", "fixed_asset_register", null);
    const [{ n }] = await serviceSql()<{ n: number }[]>`select count(*)::int n from public.gst_return_lines where engagement_id = ${ctx.engagementId} and return_type = 'GSTR2B' and is_current`;
    expect(n).toBeGreaterThan(20);
  });

  it("runs all reconciliations and finds every planted exception", async () => {
    for (const t of Object.keys(RECON_TYPES) as ReconType[]) await queueRecon(ctx.user, ctx.engagementId, t, { asOf: "2026-10-24" });
    await drainJobs();
    const sql = serviceSql();
    const runs = await sql`select recon_type, status, error from public.reconciliation_runs where engagement_id = ${ctx.engagementId}`;
    for (const r of runs) expect(r.status, `${r.recon_type}: ${r.error}`).toBe("completed");
    const ex = await sql<{ exception_type: string; doc_no: string | null }[]>`select exception_type, doc_no from public.reconciliation_exceptions where engagement_id = ${ctx.engagementId}`;
    const has = (t: string, doc?: string) => ex.some((e) => e.exception_type === t && (!doc || e.doc_no === doc));
    const expected: [string, string?][] = [
      ["MISSING_IN_GSTR1", "HDM/2627/0004"], ["MISSING_IN_GSTR1", "HDM/2627/0021"], ["UNDER_REPORTED_IN_GSTR1", "HDM/2627/0011"], ["GSTIN_MISMATCH", "HDM/2627/0016"],
      ["DUPLICATE_IN_BOOKS", "HDM/2627/0031"], ["MISSING_IN_BOOKS", "HDM/2627/9001"], ["LIABILITY_SHORT_IN_3B"], ["TIMING_DIFFERENCE"],
      ["CLAIMED_NOT_IN_2B"], ["DUPLICATE_ITC"], ["IN_2B_NOT_IN_BOOKS", "SWIFT/9911"], ["ITC_TIME_BARRED", "REAGENT/OLD/77"],
      ["IRN_NOT_IN_GSTR1", "HDM/2627/0026"], ["EWB_TAX_IN_CESS"], ["EWB_CANCELLED_DISCARDED"], ["EWB_WITHOUT_SALE", "HDM/2627/8888"],
      ["BOE_ITC_FTWZ", "8047642"], ["EXPORT_SB_MISSING"], ["ICEGATE_NOT_TRANSMITTED"], ["SB_WITHOUT_INVOICE"], ["DUTY_UNDER_PROTEST", "8159669"],
      ["BLOCKED_ITC_17_5", "LIFE/KM/552"], ["RCM_IMPORT_OF_SERVICES", "SER/2627/1498"], ["RCM_IMPORT_OF_SERVICES", "BP/2627/358"], ["RCM_NOTIFIED"],
      ["CN_BEFORE_INVOICE", "HDM/CN/2627/01"], ["CN_HSN_DIFFERS", "HDM/CN/2627/01"], ["FA_DISPOSAL"], ["CASH_LEDGER_IDLE"], ["NEGATIVE_ITC_BALANCE"],
    ];
    // bill-of-entry credit is reported once, by the imports reconciliation, not again as a GSTR-2B gap
    expect(ex.filter((e) => e.exception_type === "CLAIMED_NOT_IN_2B").map((e) => e.doc_no).sort()).toEqual(["PRECISION/26", "SWIFT/3", "TECHCARE/14"]);
    const missing = expected.filter(([t, d]) => !has(t, d));
    expect(missing, `found types: ${Array.from(new Set(ex.map((e) => e.exception_type))).sort().join(", ")}`).toEqual([]);
    const ftwz = await sql`select diff_igst from public.reconciliation_exceptions where engagement_id = ${ctx.engagementId} and exception_type = 'BOE_ITC_FTWZ'`;
    expect(ftwz[0].diff_igst).toBe("877051.00");
    const cash = await sql`select diff_tax from public.reconciliation_exceptions where engagement_id = ${ctx.engagementId} and exception_type = 'CASH_LEDGER_IDLE'`;
    expect(cash[0].diff_tax).toBe("2475430.00");
    // checklist updated by automation
    const [{ tested }] = await sql<{ tested: number }[]>`select count(*)::int tested from public.audit_test_results where engagement_id = ${ctx.engagementId} and status in ('passed','exception_detected')`;
    expect(tested).toBeGreaterThan(10);
  });

  it("drafts observations, approves them and produces the PDF report and Excel annexures", async () => {
    const sql = serviceSql();
    const pick = async (type: string) => (await sql<{ id: string }[]>`select x.id from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      where x.engagement_id = ${ctx.engagementId} and r.is_current and x.exception_type = ${type}`).map((r) => r.id);
    const ids: string[] = [];
    for (const t of ["BOE_ITC_FTWZ", "RCM_IMPORT_OF_SERVICES", "EWB_TAX_IN_CESS", "CASH_LEDGER_IDLE", "EXPORT_SB_MISSING", "FA_DISPOSAL"]) {
      ids.push(await withUser(ctx.user.id, async (tx) => createObservationFromExceptions(tx, ctx.user, ctx.engagementId, await pick(t))));
    }
    const [ftwz] = await sql`select * from public.audit_observations where id = ${ids[0]}`;
    expect(ftwz).toMatchObject({ impact_bucket: "A_ITC_REVERSAL", tax_amount: "877051.00", risk_grade: "critical", is_quantified: true });
    expect(Number(ftwz.interest_amount)).toBeGreaterThan(0);
    expect(Number(ftwz.penalty_amount)).toBeGreaterThan(0);
    const [rcm] = await sql`select * from public.audit_observations where id = ${ids[1]}`;
    expect(rcm.impact_bucket).toBe("B_RCM_OUTPUT_SHORTFALL");
    expect(rcm.itc_reavailable).toBe(rcm.tax_amount);
    // immutability of calculation snapshots
    await expect(sql`update public.financial_calculations set outputs = '{}' where id = ${ftwz.calc_snapshot_id}`).rejects.toThrow(/immutable/);
    // approval through the workflow tables (manager approves)
    await withUser(ctx.mgr.id, (tx) => tx`update public.audit_observations set status = 'approved', legal_framework = case when legal_framework = '' then 'Legal Review Required.' else legal_framework end
      where id = any(${ids}::uuid[])`);
    const { snapshot } = await withUser(ctx.mgr.id, (tx) => buildReportSnapshot(tx, ctx.engagementId, {}, [{ version: 1, label: "DRAFT", status: "draft", at: new Date().toISOString(), note: "test" }]));
    expect(snapshot.observations).toHaveLength(6);
    expect(snapshot.impact.subtotal.A).toBe(87705100);
    expect(snapshot.impact.subtotal.H).toBe(247543000);
    expect(snapshot.impact.totalTaxPayable).toBe(snapshot.impact.subtotal.A + snapshot.impact.subtotal.B + snapshot.impact.subtotal.C + snapshot.impact.subtotal.D);
    const pdf = await renderReportPdf(snapshot, "DRAFT");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(50_000);
    const xlsx = await buildAnnexures(sql, ctx.engagementId, snapshot);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["Index", "A1 Financial impact", "A3 Exceptions", "A4 ITC mismatches", "A5 RCM", "A7 Exports", "A10 Tax & interest", "A11 Checklist", "A13 Action tracker"]));
    const a3 = wb.getWorksheet("A3 Exceptions")!;
    expect(a3.rowCount).toBeGreaterThan(30);
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/demo-report.pdf", pdf);
    fs.writeFileSync("test-results/demo-annexures.xlsx", xlsx);
  });
});
