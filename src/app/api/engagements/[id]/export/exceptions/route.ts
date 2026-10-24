import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { logAction } from "@/lib/audit-log";
import { INR_FMT } from "@/lib/reports/xlsx";

/** Exports the exception register (respecting the on-screen filters) to Excel. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.isClientUser || !user.mfaVerified) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  const rows = await withUser(user.id, async (tx) => {
    const r = await tx`select x.exception_type, x.module, x.control_id, x.severity, g.gstin, x.doc_no, x.doc_date, x.counterparty_name, x.counterparty_gstin, x.period,
        x.diff_taxable, x.diff_igst, x.diff_cgst, x.diff_sgst, x.diff_cess, x.diff_tax, x.description, x.classification, x.status, x.resolution_note, cardinality(x.source_ids) sources
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id left join public.client_gstins g on g.id = x.client_gstin_id
      where x.engagement_id = ${id} and r.is_current
        ${q.get("severity") ? tx`and x.severity = ${q.get("severity")!}` : tx``} ${q.get("module") ? tx`and x.module = ${q.get("module")!}` : tx``}
        ${q.get("type") ? tx`and x.exception_type = ${q.get("type")!}` : tx``} ${q.get("status") ? tx`and x.status = ${q.get("status")!}` : tx``}
      order by x.module, x.severity, x.doc_date nulls last limit 500000`;
    await logAction(tx, { organisationId: user.orgId, actorId: user.id, action: "export", entityType: "reconciliation_exceptions", engagementId: id, context: { rows: r.length } });
    return r;
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Exceptions", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = Object.keys(rows[0] ?? { exception_type: "" });
  ws.columns = cols.map((c) => ({ header: c.replace(/_/g, " "), key: c, width: /description|resolution/.test(c) ? 60 : 16, style: c.startsWith("diff_") ? { numFmt: INR_FMT } : {} }));
  for (const r of rows) ws.addRow({ ...r, ...Object.fromEntries(cols.filter((c) => c.startsWith("diff_")).map((c) => [c, Number(r[c])])) });
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A8A2A" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="exceptions-${id.slice(0, 8)}.xlsx"`, "cache-control": "private, no-store" } });
}
