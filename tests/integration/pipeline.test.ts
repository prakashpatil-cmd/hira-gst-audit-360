import { beforeAll, describe, expect, it } from "vitest";
import { serviceSql, withUser } from "@/lib/db";
import { makeGstin } from "@/lib/gst/gstin";
import { createImport, queueValidation, queueCommit, previewImport } from "@/lib/import/service";
import { queueRecon } from "@/lib/recon/runner";
import { drainJobs, makeWorld, resetDb } from "../support/fixtures";

let W: Awaited<ReturnType<typeof makeWorld>>;
const CUST = makeGstin("29", "AAACD5678E");
const csv = (rows: (string | number)[][]) => Buffer.from(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"));

beforeAll(async () => {
  await resetDb();
  W = await makeWorld();
});

describe("Row Level Security — client segregation", () => {
  it("auditor sees only the client and engagement assigned", async () => {
    const seen = await withUser(W.auditorA.id, (tx) => tx<{ id: string }[]>`select id from public.clients`);
    expect(seen.map((c) => c.id)).toEqual([W.A.clientId]);
    const engB = await withUser(W.auditorA.id, (tx) => tx`select id from public.audit_engagements where id = ${W.B.engagementId}`);
    expect(engB).toHaveLength(0);
    const gstinsB = await withUser(W.auditorA.id, (tx) => tx`select id from public.client_gstins where client_id = ${W.B.clientId}`);
    expect(gstinsB).toHaveLength(0);
  });
  it("manager sees all clients of the firm; auditors cannot create clients", async () => {
    const seen = await withUser(W.manager.id, (tx) => tx`select id from public.clients`);
    expect(seen).toHaveLength(2);
    await expect(withUser(W.auditorA.id, (tx) => tx`insert into public.clients (organisation_id, legal_name, pan) values (${W.orgId}, 'X', 'AABCX1234X')`))
      .rejects.toThrow(/row-level security/);
  });
  it("a manager creates a client and an engagement through RLS (INSERT … RETURNING)", async () => {
    const [c] = await withUser(W.manager.id, (tx) => tx<{ id: string }[]>`insert into public.clients (organisation_id, legal_name, pan)
      values (${W.orgId}, 'Returning Test Ltd', 'AABCR1234R') returning id`);
    expect(c.id).toBeTruthy();
    const [e] = await withUser(W.manager.id, (tx) => tx<{ id: string }[]>`insert into public.audit_engagements (organisation_id, client_id, engagement_code, title, financial_year, period_from, period_to)
      values (${W.orgId}, ${c.id}, 'RLS-RET', 'RLS returning', '2026-27', '2026-04-01', '2026-06-30') returning id`);
    expect(e.id).toBeTruthy();
    await serviceSql()`delete from public.audit_engagements where id = ${e.id}`;
    await serviceSql()`delete from public.clients where id = ${c.id}`;
  });
  it("client user sees only its own client and no working papers", async () => {
    const clients = await withUser(W.clientA.id, (tx) => tx<{ id: string }[]>`select id from public.clients`);
    expect(clients.map((c) => c.id)).toEqual([W.A.clientId]);
    const runs = await withUser(W.clientA.id, (tx) => tx`select id from public.data_imports`);
    expect(runs).toHaveLength(0);
  });
  it("an unassigned auditor cannot upload data into another client's engagement", async () => {
    await expect(createImport(W.auditorB, { engagementId: W.A.engagementId, clientGstinId: W.A.gstinIds[0], datasetType: "sales_register",
      fileName: "s.csv", body: csv([["Invoice No", "Date", "Taxable Value"], ["1", "01/04/2026", "100"]]) })).rejects.toThrow(/not found|not accessible/);
  });
  it("audit log is append-only and records changes with the acting user", async () => {
    await withUser(W.manager.id, (tx) => tx`update public.clients set industry = 'Chemicals' where id = ${W.A.clientId}`);
    const sql = serviceSql();
    const [log] = await sql<{ actor_id: string; action: string }[]>`select actor_id, action from public.audit_logs where entity_type = 'clients' and entity_id = ${W.A.clientId} order by id desc limit 1`;
    expect(log).toMatchObject({ actor_id: W.manager.id, action: "update" });
    await expect(sql`delete from public.audit_logs where entity_id = ${W.A.clientId}`).rejects.toThrow(/immutable/);
  });
});

describe("Import → validate → commit → reconcile", () => {
  it("processes actual files and detects inserted mismatches", async () => {
    const g = W.A.gstinIds[0];
    const sales = csv([
      ["Voucher Type", "Invoice No", "Invoice Date", "Customer GSTIN", "Customer Name", "Place of Supply", "HSN", "Rate", "Taxable Value", "IGST", "CGST", "SGST", "Invoice Value"],
      ["Sales", "INV/001", "05/04/2026", CUST, "Delta Labs", "29-Karnataka", "38221990", "18%", "1,00,000.00", "18000", "0", "0", "118000"],
      ["Sales", "INV/002", "12/04/2026", CUST, "Delta Labs", "29", "38221990", "18", "50000", "9000", "0", "0", "59000"],      // missing in GSTR-1
      ["Sales", "INV/003", "20/04/2026", CUST, "Delta Labs", "29", "38221990", "18", "20000", "3600", "0", "0", "23600"],      // tax mismatch
      ["Sales", "INV/003", "20/04/2026", CUST, "Delta Labs", "29", "38221990", "18", "20000", "3600", "0", "0", "23600"],      // duplicate row
      ["Sales", "INV/004", "31/06/2026", CUST, "Delta Labs", "29", "38221990", "18", "1000", "180", "0", "0", "1180"],          // invalid date → rejected
      ["Credit Note", "CN/01", "25/04/2026", CUST, "Delta Labs", "29", "38221990", "18", "-5000", "-900", "0", "0", "-5900"],
    ]);
    const impId = await createImport(W.auditorA, { engagementId: W.A.engagementId, clientGstinId: g, datasetType: "sales_register", fileName: "sales.csv", body: sales });
    const pv = await previewImport(W.auditorA, impId, 10);
    expect(pv.headers).toContain("Customer GSTIN");
    expect(pv.rows[0].result.common.taxable_value).toBe("100000.00");
    await queueValidation(W.auditorA, impId);
    await drainJobs();
    const sql = serviceSql();
    const [imp] = await sql`select * from public.data_imports where id = ${impId}`;
    expect(imp.status).toBe("validated");
    expect(imp.total_rows).toBe(6);
    expect(imp.rejected_rows).toBe(1);
    expect(imp.duplicate_rows).toBe(0);           // within-file repeat is committed with a warning, not dropped
    expect(imp.quality_report.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(["INVALID_DATE", "DUPLICATE_IN_FILE"]));
    await queueCommit(W.auditorA, impId);
    await drainJobs();
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from public.sales_invoices where import_id = ${impId}`;
    expect(n).toBe(4);
    const [cn] = await sql`select * from public.credit_notes where import_id = ${impId}`;
    expect(cn).toMatchObject({ side: "outward", note_no: "CN/01", taxable_value: "5000.00", igst: "900.00" });

    const gstr1 = csv([
      ["Section", "Invoice Number", "Invoice date", "GSTIN/UIN of Recipient", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Return Period"],
      ["B2B", "INV-001", "05-04-2026", CUST, "18", "100000", "18000", "0", "0", "042026"],
      ["B2B", "INV/003", "20-04-2026", CUST, "18", "20000", "2000", "0", "0", "042026"],
      ["B2B", "INV/999", "28-04-2026", CUST, "18", "7000", "1260", "0", "0", "042026"],
      ["CDNR", "CN/01", "25-04-2026", CUST, "18", "5000", "900", "0", "0", "042026"],
    ]);
    const g1 = await createImport(W.auditorA, { engagementId: W.A.engagementId, clientGstinId: g, datasetType: "gstr1", fileName: "gstr1.csv", body: gstr1 });
    await queueValidation(W.auditorA, g1); await drainJobs();
    await queueCommit(W.auditorA, g1); await drainJobs();
    const [ret] = await sql`select count(*)::int n from public.gst_return_lines where engagement_id = ${W.A.engagementId} and return_type = 'GSTR1'`;
    expect(ret.n).toBe(4);

    const runId = await queueRecon(W.auditorA, W.A.engagementId, "BOOKS_GSTR1");
    await drainJobs();
    const [run] = await sql`select * from public.reconciliation_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    const exs = await sql<{ exception_type: string; doc_no: string; diff_tax: string; source_ids: string[] }[]>`
      select exception_type, doc_no, diff_tax, source_ids from public.reconciliation_exceptions where run_id = ${runId} order by exception_type`;
    const types = exs.map((e) => `${e.exception_type}:${e.doc_no}`);
    expect(types).toEqual(expect.arrayContaining(["MISSING_IN_GSTR1:INV/002", "UNDER_REPORTED_IN_GSTR1:INV/003", "MISSING_IN_BOOKS:INV/999", "DUPLICATE_IN_BOOKS:INV/003"]));
    expect(exs.find((e) => e.doc_no === "INV/003" && e.exception_type === "UNDER_REPORTED_IN_GSTR1")!.diff_tax).toBe("1600.00");
    // drill-down: the exception points at the original source rows
    const src = await sql`select row_number, raw from public.source_transactions where id = any(${exs.find((e) => e.doc_no === "INV/002")!.source_ids}::uuid[])`;
    expect(src[0].raw["Invoice No"]).toBe("INV/002");
    expect(src[0].row_number).toBe(3);

    // re-run carries forward triage and is reproducible
    await sql`update public.reconciliation_exceptions set status = 'explained', resolution_note = 'Reported in May' where run_id = ${runId} and doc_no = 'INV/002'`;
    const run2 = await queueRecon(W.auditorA, W.A.engagementId, "BOOKS_GSTR1");
    await drainJobs();
    const [r2] = await sql`select input_hash, summary from public.reconciliation_runs where id = ${run2}`;
    expect(r2.input_hash).toBe(run.input_hash);
    const [carried] = await sql`select status, resolution_note from public.reconciliation_exceptions where run_id = ${run2} and doc_no = 'INV/002'`;
    expect(carried).toMatchObject({ status: "explained", resolution_note: "Reported in May" });
  });

  it("replace-mode re-import supersedes the earlier version without deleting lineage", async () => {
    const g = W.A.gstinIds[0];
    const sales = csv([["Invoice No", "Invoice Date", "Customer GSTIN", "Taxable Value", "IGST"], ["INV/001", "05/04/2026", CUST, "100000", "18000"]]);
    const id = await createImport(W.auditorA, { engagementId: W.A.engagementId, clientGstinId: g, datasetType: "sales_register", fileName: "sales-v2.csv", body: sales });
    await queueValidation(W.auditorA, id); await drainJobs();
    await queueCommit(W.auditorA, id); await drainJobs();
    const sql = serviceSql();
    const rows = await sql`select di.version, di.status, count(si.*) filter (where si.is_current)::int cur from public.data_imports di
      left join public.sales_invoices si on si.import_id = di.id where di.engagement_id = ${W.A.engagementId} and di.dataset_type = 'sales_register'
      group by 1, 2 order by 1`;
    expect(rows.map((r) => [r.version, r.status, r.cur])).toEqual([[1, "superseded", 0], [2, "committed", 1]]);
  });
});
