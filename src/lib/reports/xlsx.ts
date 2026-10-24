import ExcelJS from "exceljs";
import type { Sql, Tx } from "@/lib/db";
import type { ReportSnapshot } from "./snapshot";
import { formatINR } from "@/lib/gst/money";

/** Indian digit grouping in Excel (lakh/crore separators). */
export const INR_FMT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const GREEN = "FF5A8A2A";

type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean };

function sheet(wb: ExcelJS.Workbook, name: string, title: string, cols: Col[], rows: Record<string, unknown>[], note?: string) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13, color: { argb: GREEN } };
  ws.getCell("A2").value = note ?? "";
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B6B6B" } };
  const header = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
    ws.getColumn(i + 1).width = c.width ?? (c.money ? 16 : 18);
    if (c.money) ws.getColumn(i + 1).numFmt = INR_FMT;
  });
  header.height = 30;
  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    cols.forEach((c, i) => {
      const v = r[c.key];
      row.getCell(i + 1).value = v == null ? null : c.money ? Number(v) : c.date && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.slice(0, 10) + "T00:00:00Z") : (v as ExcelJS.CellValue);
      if (c.date) row.getCell(i + 1).numFmt = "dd/mm/yyyy";
    });
  });
  if (rows.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } };
    const total = ws.getRow(5 + rows.length);
    let any = false;
    cols.forEach((c, i) => {
      if (!c.money) return;
      any = true;
      const L = ws.getColumn(i + 1).letter;
      total.getCell(i + 1).value = { formula: `SUBTOTAL(9,${L}5:${L}${4 + rows.length})` };
      total.getCell(i + 1).font = { bold: true };
    });
    if (any) { total.getCell(1).value = "Total (visible rows)"; total.getCell(1).font = { bold: true }; }
  } else {
    ws.getCell("A5").value = "No records for this annexure.";
  }
  ws.headerFooter.oddFooter = "&LHIRA Associates | Your GST Compliance Partner&RPage &P of &N";
  return ws;
}

/**
 * Builds the Excel working-paper annexures for a report version. Observation-level figures come
 * from the frozen snapshot; invoice-level workings come from the current reconciliation runs.
 */
export async function buildAnnexures(db: Sql | Tx, engagementId: string, snap: ReportSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HIRA GST Audit 360°";
  wb.company = snap.firm.brand.firmName;
  wb.created = new Date(snap.generatedAt);
  const e = snap.engagement;
  const sub = `${e.clientName} | ${e.code} | ${e.periodFrom} to ${e.periodTo} | Generated ${snap.generatedAt.slice(0, 10)}`;

  // 1. Summary / index
  const ws = wb.addWorksheet("Index");
  ws.getColumn(1).width = 8; ws.getColumn(2).width = 48; ws.getColumn(3).width = 70;
  ws.getCell("B1").value = "GST Health Check — Annexures"; ws.getCell("B1").font = { bold: true, size: 15, color: { argb: GREEN } };
  ws.getCell("B2").value = sub;
  ws.getCell("B3").value = "Strictly confidential — prepared for the management of " + e.clientName;
  ws.getCell("B3").font = { italic: true, color: { argb: "FFC0392B" } };
  const index = [
    ["A1", "Financial impact", "Financial impact at a glance (from the approved observations in the report)"],
    ["A2", "Observations", "Summary of observations with quantification"],
    ["A3", "Invoice-level exceptions", "All open and investigated exceptions with source references"],
    ["A4", "ITC mismatches", "Purchase register vs GSTR-2B vs GSTR-3B exceptions"],
    ["A5", "RCM calculations", "Reverse charge items with tax and interest workings"],
    ["A6", "E-way bill mismatches", "E-way bill vs sales exceptions"],
    ["A7", "Export documentation", "Export evidence completeness by invoice"],
    ["A8", "ISD reconciliation", "Input Service Distributor exceptions"],
    ["A9", "Vendor compliance", "Supplier-wise ITC exceptions and GSTIN validity"],
    ["A10", "Tax & interest workings", "Line-level calculation snapshots for each observation"],
    ["A11", "Audit control checklist", "Status of every applicable control"],
    ["A12", "Pending documents", "Information requests not yet received or accepted"],
    ["A13", "Action tracker", "Priority action plan and corrective actions"],
  ];
  index.forEach((r, i) => { const row = ws.getRow(5 + i); row.values = r; row.getCell(1).font = { bold: true, color: { argb: GREEN } }; });

  // A1 impact
  const im = snap.impact;
  const impactRows: Record<string, unknown>[] = [];
  const add = (head: string, lines: { obs: number; basis: string; amount: number }[], nature: string, sign = 1) => {
    if (!lines.length) return;
    impactRows.push({ obs: head, basis: "", amount: null, nature: "" });
    for (const l of lines) impactRows.push({ obs: l.obs, basis: l.basis, amount: (sign * l.amount) / 100, nature });
  };
  add("A. ITC wrongly availed — to be reversed", im.A, "Cash outflow");
  add("B. RCM and output tax not discharged", im.B, "Cash outflow");
  add("C. Output tax on inadmissible credit notes", im.C, "Cash outflow");
  add("D. Other statutory tax liabilities", im.D, "Cash outflow");
  impactRows.push({ obs: "TOTAL TAX PAYABLE", basis: "", amount: im.totalTaxPayable / 100, nature: "Payable" });
  add("E. Less: ITC re-available", im.E, "Recoverable", -1);
  impactRows.push({ obs: "NET CASH OUTFLOW BEFORE INTEREST", basis: "", amount: im.netCashBeforeInterest / 100, nature: "Net payable" });
  add("F. Contingent", im.F, "Contingent");
  add("G/H. Recoverable / cash ledger transfer", [...im.G, ...im.H], "In the company's favour");
  impactRows.push({ obs: "I. Estimated interest (indicative)", basis: "", amount: im.interest / 100, nature: "Additional" });
  impactRows.push({ obs: "J. Potential penalties (separate)", basis: "", amount: im.penalty / 100, nature: "Potential" });
  const a1 = wb.addWorksheet("A1 Financial impact");
  a1.getCell("A1").value = "Financial impact at a glance"; a1.getCell("A1").font = { bold: true, size: 13, color: { argb: GREEN } };
  a1.getCell("A2").value = "Totals are entered as values so they agree with the report; unquantified observations are excluded from every total.";
  a1.columns = [{ key: "obs", width: 44 }, { key: "basis", width: 80 }, { key: "amount", width: 18, style: { numFmt: INR_FMT } }, { key: "nature", width: 22 }];
  a1.getRow(4).values = ["Obs. / head", "Basis of the figure", "Amount (₹)", "Nature"];
  a1.getRow(4).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } }; });
  impactRows.forEach((r, i) => { const row = a1.getRow(5 + i); row.values = [r.obs as string, r.basis as string, r.amount as number, r.nature as string];
    if (typeof r.obs === "string" && /^[A-J]\.|TOTAL|NET/.test(r.obs)) row.font = { bold: true }; });
  for (const u of im.unquantified) a1.addRow([`Obs. ${u.obs}`, `${u.title} — ${u.text}`, null, "Unquantified"]);

  sheet(wb, "A2 Observations", "Summary of observations", [
    { header: "No.", key: "obs_number", width: 6 }, { header: "Title", key: "title", width: 60 }, { header: "Category", key: "category", width: 22 },
    { header: "Part", key: "part_label", width: 18 }, { header: "GSTIN", key: "gstin", width: 18 }, { header: "Risk", key: "risk_grade", width: 11 },
    { header: "Classification", key: "classification", width: 20 }, { header: "Tax (₹)", key: "tax_amount", money: true }, { header: "Interest (₹)", key: "interest_amount", money: true },
    { header: "Potential penalty (₹)", key: "penalty_amount", money: true }, { header: "Impact", key: "impact_label", width: 30 }, { header: "Status", key: "status", width: 16 },
    { header: "Action owner", key: "action_owner", width: 18 }, { header: "Target date", key: "target_date", date: true, width: 12 },
  ], snap.observations as unknown as Record<string, unknown>[], sub);

  const exCols: Col[] = [
    { header: "Module", key: "module", width: 7 }, { header: "Exception", key: "exception_type", width: 28 }, { header: "Risk", key: "severity", width: 11 },
    { header: "GSTIN", key: "gstin", width: 18 }, { header: "Document", key: "doc_no", width: 20 }, { header: "Date", key: "doc_date", date: true, width: 12 },
    { header: "Counterparty", key: "counterparty_name", width: 26 }, { header: "Counterparty GSTIN", key: "counterparty_gstin", width: 18 },
    { header: "Period", key: "period", date: true, width: 11 }, { header: "Taxable diff. (₹)", key: "diff_taxable", money: true }, { header: "IGST (₹)", key: "diff_igst", money: true },
    { header: "CGST (₹)", key: "diff_cgst", money: true }, { header: "SGST (₹)", key: "diff_sgst", money: true }, { header: "Cess (₹)", key: "diff_cess", money: true },
    { header: "Tax diff. (₹)", key: "diff_tax", money: true }, { header: "Description", key: "description", width: 80 }, { header: "Classification", key: "classification", width: 20 },
    { header: "Status", key: "status", width: 14 }, { header: "Observation", key: "obs_number", width: 10 }, { header: "Explanation", key: "resolution_note", width: 40 },
    { header: "Source rows (file v/row)", key: "sources", width: 40 },
  ];
  const exRows = await db`select x.*, g.gstin, o.obs_number,
      (select string_agg(d.file_name || ' v' || i.version || ' r' || st.row_number, '; ' order by st.row_number)
         from public.source_transactions st join public.data_imports i on i.id = st.import_id join public.source_documents d on d.id = i.source_document_id
        where st.id = any(x.source_ids[1:20])) sources
    from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
    left join public.client_gstins g on g.id = x.client_gstin_id left join public.audit_observations o on o.id = x.observation_id
    where x.engagement_id = ${engagementId} and r.is_current and x.status <> 'not_an_issue'
    order by x.module, case x.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, x.doc_date nulls last limit 200000`;
  const rows = exRows as unknown as Record<string, unknown>[];
  sheet(wb, "A3 Exceptions", "Invoice-level exceptions", exCols, rows, sub);
  sheet(wb, "A4 ITC mismatches", "ITC — purchase register vs GSTR-2B vs GSTR-3B", exCols, rows.filter((r) => r.recon_type === "PR_2B_3B" || r.module === "C"), sub);
  sheet(wb, "A5 RCM", "Reverse charge — tax and interest", exCols, rows.filter((r) => r.module === "D"), sub +
    " | Interest per observation is in A10; reverse charge discharged is generally available as credit in the same period subject to Section 16.");
  sheet(wb, "A6 E-way bills", "E-way bill vs sales", exCols, rows.filter((r) => r.module === "G"), sub);

  const exp = await db`
    with inv as (select s.invoice_no_norm k, min(s.invoice_no) invoice_no, min(s.invoice_date) invoice_date, sum(s.taxable_value) taxable
      from public.sales_invoices s where s.engagement_id = ${engagementId} and s.is_current and (s.supply_type ilike '%export%' or s.place_of_supply = '96') group by 1),
    g1 as (select doc_no_norm k, bool_or(shipping_bill_no is not null and shipping_bill_date is not null and port_code is not null) sb_in_return
      from public.gst_return_lines where engagement_id = ${engagementId} and is_current and return_type = 'GSTR1' and table_code like '6A%' group by 1),
    sb as (select invoice_no_norm k, min(sb_no) sb_no, min(sb_date) sb_date, min(port_code) port, min(leo_date) leo_date, min(egm_no) egm_no, min(brc_no) brc_no, min(icegate_status) icegate
      from public.shipping_bills where engagement_id = ${engagementId} and is_current group by 1)
    select coalesce(inv.invoice_no, g1.k) invoice_no, inv.invoice_date, inv.taxable, case when inv.k is null then 'No' else 'Yes' end in_books,
      case when g1.k is null then 'No' else 'Yes' end in_gstr1, case when g1.sb_in_return then 'Yes' else 'No' end sb_in_return,
      sb.sb_no, sb.sb_date, sb.port, sb.leo_date, sb.egm_no, sb.brc_no, sb.icegate,
      case when sb.leo_date is not null and sb.leo_date <= inv.invoice_date + interval '3 months' then 'Met' when sb.leo_date is not null then 'Breached'
           when inv.invoice_date + interval '3 months' < current_date then 'Not evidenced' else 'Open' end rule_96a
    from inv full join g1 on g1.k = inv.k left join sb on sb.k = coalesce(inv.k, g1.k) order by inv.invoice_date nulls last`;
  sheet(wb, "A7 Exports", "Export evidence completeness", [
    { header: "Invoice", key: "invoice_no", width: 20 }, { header: "Date", key: "invoice_date", date: true, width: 12 }, { header: "Taxable (₹)", key: "taxable", money: true },
    { header: "In books", key: "in_books", width: 9 }, { header: "In GSTR-1 6A", key: "in_gstr1", width: 11 }, { header: "SB in return", key: "sb_in_return", width: 11 },
    { header: "Shipping bill", key: "sb_no", width: 14 }, { header: "SB date", key: "sb_date", date: true, width: 12 }, { header: "Port", key: "port", width: 9 },
    { header: "LEO date", key: "leo_date", date: true, width: 12 }, { header: "EGM", key: "egm_no", width: 12 }, { header: "BRC", key: "brc_no", width: 14 },
    { header: "ICEGATE status", key: "icegate", width: 16 }, { header: "Rule 96A(1)", key: "rule_96a", width: 14 },
  ], exp as unknown as Record<string, unknown>[], sub);
  sheet(wb, "A8 ISD", "Input Service Distributor reconciliation", exCols, rows.filter((r) => r.module === "E"), sub + " | Import GSTR-6 / ISD workings to extend this annexure.");

  const vendors = await db`select coalesce(x.counterparty_gstin, '(no GSTIN)') gstin, max(x.counterparty_name) name, count(*)::int exceptions,
      count(*) filter (where x.exception_type = 'CLAIMED_NOT_IN_2B')::int not_in_2b, count(*) filter (where x.exception_type = 'INVALID_GSTIN')::int invalid_gstin,
      count(*) filter (where x.exception_type in ('SUPPLIER_CN_NOT_BOOKED'))::int cn_not_booked, sum(x.diff_tax) filter (where x.diff_tax > 0) tax_at_risk
    from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
    where x.engagement_id = ${engagementId} and r.is_current and x.module = 'C' group by 1 order by tax_at_risk desc nulls last`;
  sheet(wb, "A9 Vendors", "Vendor compliance", [
    { header: "Supplier GSTIN", key: "gstin", width: 18 }, { header: "Supplier", key: "name", width: 32 }, { header: "Exceptions", key: "exceptions", width: 11 },
    { header: "Claimed, not in GSTR-2B", key: "not_in_2b", width: 14 }, { header: "Invalid GSTIN", key: "invalid_gstin", width: 12 },
    { header: "Credit notes not booked", key: "cn_not_booked", width: 14 }, { header: "ITC at risk (₹)", key: "tax_at_risk", money: true },
  ], vendors as unknown as Record<string, unknown>[], sub);

  const calcRows: Record<string, unknown>[] = [];
  const calcIds = snap.observations.map((o) => o.calc?.id).filter(Boolean) as string[];
  const calcs = calcIds.length ? await db`select f.*, o.obs_number from public.financial_calculations f join public.audit_observations o on o.id = f.observation_id where f.id = any(${calcIds}::uuid[])` : [];
  for (const c of calcs) {
    const out = c.outputs as { lines?: { docNo: string; period: string; tax: number; interestFrom: string | null; days: number; interest: number; basis: string | null }[]; tax?: number | string };
    if (out.lines?.length) for (const l of out.lines) calcRows.push({ obs: c.obs_number, calc: String(c.id).slice(0, 8), type: c.calc_type, doc: l.docNo, period: l.period,
      tax: l.tax / 100, from: l.interestFrom, days: l.days, interest: l.interest / 100, basis: l.basis, hash: String(c.input_hash).slice(0, 16) });
    else calcRows.push({ obs: c.obs_number, calc: String(c.id).slice(0, 8), type: c.calc_type, doc: "Manual working", tax: Number(out.tax ?? 0), basis: (c.inputs as { basis?: string }).basis ?? null,
      hash: String(c.input_hash).slice(0, 16) });
  }
  sheet(wb, "A10 Tax & interest", "Tax and interest workings (calculation snapshots)", [
    { header: "Obs.", key: "obs", width: 6 }, { header: "Snapshot", key: "calc", width: 10 }, { header: "Type", key: "type", width: 20 }, { header: "Document", key: "doc", width: 22 },
    { header: "Period", key: "period", date: true, width: 11 }, { header: "Tax (₹)", key: "tax", money: true }, { header: "Interest from", key: "from", date: true, width: 13 },
    { header: "Days", key: "days", width: 7 }, { header: "Interest (₹)", key: "interest", money: true }, { header: "Basis", key: "basis", width: 50 }, { header: "Input hash", key: "hash", width: 18 },
  ], calcRows, sub + " | Interest at 18% p.a. under Section 50 on a 365-day basis, rounded to the rupee; indicative to the computation date.");

  const checklist = await db`select t.control_id, ac.module, ac.title, cv.risk_level, t.status, t.applicability_note, t.work_performed, t.conclusion, t.exceptions_count,
      u.full_name tested_by, t.tested_at, r.full_name reviewed_by, t.reviewed_at
    from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id join public.control_versions cv on cv.id = t.control_version_id
    left join public.users u on u.id = t.tested_by left join public.users r on r.id = t.reviewed_by where t.engagement_id = ${engagementId} order by t.control_id`;
  sheet(wb, "A11 Checklist", "Audit control checklist", [
    { header: "Control", key: "control_id", width: 12 }, { header: "Module", key: "module", width: 7 }, { header: "Title", key: "title", width: 50 }, { header: "Risk", key: "risk_level", width: 10 },
    { header: "Status", key: "status", width: 20 }, { header: "Applicability", key: "applicability_note", width: 30 }, { header: "Work performed", key: "work_performed", width: 60 },
    { header: "Conclusion", key: "conclusion", width: 40 }, { header: "Exceptions", key: "exceptions_count", width: 10 }, { header: "Tested by", key: "tested_by", width: 18 },
    { header: "Tested on", key: "tested_at", date: true, width: 12 }, { header: "Reviewed by", key: "reviewed_by", width: 18 }, { header: "Reviewed on", key: "reviewed_at", date: true, width: 12 },
  ], (checklist as unknown as Record<string, unknown>[]).map((r) => ({ ...r, tested_at: r.tested_at ? new Date(r.tested_at as string).toISOString() : null,
    reviewed_at: r.reviewed_at ? new Date(r.reviewed_at as string).toISOString() : null })), sub + ` | ${snap.coverage.conclusion}`);

  const pending = await db`select title, category, priority, due_date, status, reminder_count, review_comment from public.document_requests
    where engagement_id = ${engagementId} and status in ('requested','rejected','uploaded') order by priority, due_date nulls last`;
  sheet(wb, "A12 Pending documents", "Pending documents and information", [
    { header: "Item", key: "title", width: 60 }, { header: "Category", key: "category", width: 18 }, { header: "Priority", key: "priority", width: 10 },
    { header: "Due", key: "due_date", date: true, width: 12 }, { header: "Status", key: "status", width: 12 }, { header: "Reminders", key: "reminder_count", width: 10 },
    { header: "Comment", key: "review_comment", width: 40 },
  ], pending as unknown as Record<string, unknown>[], sub);

  const actions = await db`select a.priority, a.title, o.obs_number, a.compliance_step, a.owner_name, a.due_date, a.statutory_deadline, a.amount, a.amount_label, a.status, a.completion_note
    from public.corrective_actions a left join public.audit_observations o on o.id = a.observation_id where a.engagement_id = ${engagementId}
    order by a.statutory_deadline nulls last, a.priority, a.due_date nulls last`;
  sheet(wb, "A13 Action tracker", "Priority action plan and corrective actions", [
    { header: "P", key: "priority", width: 5 }, { header: "Action", key: "title", width: 60 }, { header: "Obs.", key: "obs_number", width: 6 }, { header: "Step", key: "compliance_step", width: 20 },
    { header: "Owner", key: "owner_name", width: 18 }, { header: "Due", key: "due_date", date: true, width: 12 }, { header: "Statutory deadline", key: "statutory_deadline", date: true, width: 13 },
    { header: "Amount (₹)", key: "amount", money: true }, { header: "Amount note", key: "amount_label", width: 18 }, { header: "Status", key: "status", width: 12 },
    { header: "Completion evidence", key: "completion_note", width: 40 },
  ], actions as unknown as Record<string, unknown>[], sub);

  void formatINR;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
