import ExcelJS from "exceljs";
import Papa from "papaparse";

export type Cell = string | number | boolean | Date | null;
export interface ParsedTable {
  sheets: string[];
  sheet: string | null;
  headerRow: number;              // 1-based row index of the header within the sheet
  headers: string[];
  rows: { rowNumber: number; values: Record<string, Cell> }[];
  format: "xlsx" | "csv" | "json" | "gstr1_json" | "gstr2b_json";
}

export interface ParseOptions { sheet?: string | null; headerRow?: number | null; maxRows?: number }

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result as ExcelJS.CellValue);
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return null;
    return String(v);
  }
  return v as Cell;
}

/** Picks the header row: the first of the top 20 rows with the most non-empty text cells. */
function detectHeaderRow(grid: Cell[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(20, grid.length); i++) {
    const row = grid[i] ?? [];
    const texts = row.filter((c) => typeof c === "string" && c.trim() && !/^\d+([.,]\d+)?$/.test(c.trim())).length;
    const nonEmpty = row.filter((c) => c != null && String(c).trim() !== "").length;
    const score = texts * 2 + nonEmpty;
    if (texts >= 2 && score > bestScore) { best = i; bestScore = score; }
  }
  return best + 1;
}

function uniqueHeaders(raw: Cell[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((c, i) => {
    let h = c == null ? "" : String(c).replace(/\s+/g, " ").trim();
    if (!h) h = `Column ${i + 1}`;
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h} (${n + 1})` : h;
  });
}

function gridToTable(grid: Cell[][], opts: ParseOptions, base: Omit<ParsedTable, "headerRow" | "headers" | "rows">): ParsedTable {
  const headerRow = opts.headerRow ?? detectHeaderRow(grid);
  const headers = uniqueHeaders(grid[headerRow - 1] ?? []);
  const rows: ParsedTable["rows"] = [];
  for (let i = headerRow; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (r.every((c) => c == null || String(c).trim() === "")) continue;
    const values: Record<string, Cell> = {};
    headers.forEach((h, j) => { values[h] = r[j] ?? null; });
    rows.push({ rowNumber: i + 1, values });
    if (opts.maxRows && rows.length >= opts.maxRows) break;
  }
  return { ...base, headerRow, headers, rows };
}

export async function parseFile(fileName: string, body: Buffer, opts: ParseOptions = {}): Promise<ParsedTable> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ArrayBuffer);
    const sheets = wb.worksheets.map((w) => w.name);
    const ws = (opts.sheet && wb.getWorksheet(opts.sheet)) || wb.worksheets.find((w) => w.actualRowCount > 0) || wb.worksheets[0];
    if (!ws) throw new Error("Workbook has no worksheets");
    const grid: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = row.values as ExcelJS.CellValue[];        // 1-based array
      grid[n - 1] = vals.slice(1).map(cellValue);
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    return gridToTable(grid, opts, { sheets, sheet: ws.name, format: "xlsx" });
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = body.toString("utf8").replace(/^﻿/, "");
    const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
    const grid = res.data.map((r) => r.map((c) => (c === "" ? null : c)));
    return gridToTable(grid, opts, { sheets: [], sheet: null, format: "csv" });
  }
  if (lower.endsWith(".json")) {
    const data = JSON.parse(body.toString("utf8"));
    const portal = flattenPortalJson(data);
    const objects = portal?.rows ?? (Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null);
    if (!objects) throw new Error("JSON must be an array of records or a GSTR-1 / GSTR-2B portal download");
    const headers: string[] = Array.from(new Set<string>(objects.flatMap((o: Record<string, unknown>) => Object.keys(o))));
    const rows = objects.map((o: Record<string, unknown>, i: number) => ({
      rowNumber: i + 1,
      values: Object.fromEntries(headers.map((h) => [h, (o[h] ?? null) as Cell])),
    }));
    return { sheets: [], sheet: null, headerRow: 0, headers, rows, format: portal?.format ?? "json" };
  }
  throw new Error("Unsupported file type for data import (use .xlsx, .csv or .json)");
}

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Flattens GST portal JSON downloads into one row per invoice item.
 * GSTR-2B: data.docdata.{b2b,b2ba,cdnr,impg,isd}; GSTR-1: {b2b,exp,cdnr,b2cs,b2cl,fp}.
 */
export function flattenPortalJson(data: Obj): { format: "gstr1_json" | "gstr2b_json"; rows: Obj[] } | null {
  const docdata = data?.data?.docdata ?? data?.docdata;
  if (docdata) {
    const period = data?.data?.rtnprd ?? data?.rtnprd ?? null;
    const rows: Obj[] = [];
    for (const sup of docdata.b2b ?? []) for (const inv of sup.inv ?? []) for (const it of inv.items ?? [{}]) rows.push({
      section: "B2B", doc_type: "INV", ctin: sup.ctin, trdnm: sup.trdnm, supfildt: sup.supfildt, period: sup.supprd ?? period,
      inum: inv.inum, dt: inv.dt, val: inv.val, pos: inv.pos, rev: inv.rev, itcavl: inv.itcavl, rsn: inv.rsn,
      rt: it.rt, txval: it.txval ?? inv.txval, igst: it.igst ?? 0, cgst: it.cgst ?? 0, sgst: it.sgst ?? 0, cess: it.cess ?? 0,
      rtnprd: period,
    });
    for (const sup of docdata.cdnr ?? []) for (const nt of sup.nt ?? []) for (const it of nt.items ?? [{}]) rows.push({
      section: "CDNR", doc_type: nt.typ === "D" ? "DBN" : "CRN", ctin: sup.ctin, trdnm: sup.trdnm, supfildt: sup.supfildt, period: sup.supprd ?? period,
      inum: nt.ntnum, dt: nt.dt, val: nt.val, pos: nt.pos, rev: nt.rev, itcavl: nt.itcavl, rsn: nt.rsn,
      rt: it.rt, txval: it.txval, igst: it.igst ?? 0, cgst: it.cgst ?? 0, sgst: it.sgst ?? 0, cess: it.cess ?? 0, rtnprd: period,
    });
    for (const b of docdata.impg ?? []) rows.push({
      section: "IMPG", doc_type: "BOE", inum: b.boenum, dt: b.boedt, port: b.portcode, txval: b.txval, igst: b.igst ?? 0, cess: b.cess ?? 0,
      period, rtnprd: period, itcavl: "Y",
    });
    for (const sup of docdata.isd ?? []) for (const d of sup.doclist ?? []) rows.push({
      section: "ISD", doc_type: d.doctyp === "C" ? "CRN" : "INV", ctin: sup.ctin, trdnm: sup.trdnm, inum: d.docnum, dt: d.docdt,
      igst: d.igst ?? 0, cgst: d.cgst ?? 0, sgst: d.sgst ?? 0, cess: d.cess ?? 0, txval: 0, itcavl: d.itcelg ?? "Y", period, rtnprd: period,
    });
    return { format: "gstr2b_json", rows };
  }
  if (data && (data.b2b || data.exp || data.cdnr || data.b2cs) && data.fp) {
    const fp = data.fp;
    const rows: Obj[] = [];
    const det = (itm: Obj) => itm.itm_det ?? itm;
    for (const c of data.b2b ?? []) for (const inv of c.inv ?? []) for (const it of inv.itms ?? []) { const d = det(it); rows.push({
      table: "4A", doc_type: "INV", ctin: c.ctin, inum: inv.inum, idt: inv.idt, val: inv.val, pos: inv.pos, rchrg: inv.rchrg,
      rt: d.rt, txval: d.txval, iamt: d.iamt ?? 0, camt: d.camt ?? 0, samt: d.samt ?? 0, csamt: d.csamt ?? 0, fp }); }
    for (const e of data.exp ?? []) for (const inv of e.inv ?? []) for (const it of inv.itms ?? []) { const d = det(it); rows.push({
      table: `6A-${e.exp_typ ?? "EXP"}`, doc_type: "INV", inum: inv.inum, idt: inv.idt, val: inv.val, sbnum: inv.sbnum, sbdt: inv.sbdt,
      sbpcode: inv.sbpcode, rt: d.rt, txval: d.txval, iamt: d.iamt ?? 0, csamt: d.csamt ?? 0, fp }); }
    for (const c of data.cdnr ?? []) for (const nt of c.nt ?? []) for (const it of nt.itms ?? []) { const d = det(it); rows.push({
      table: "9B", doc_type: nt.ntty === "D" ? "DBN" : "CRN", ctin: c.ctin, inum: nt.nt_num, idt: nt.nt_dt, val: nt.val, pos: nt.pos,
      rt: d.rt, txval: d.txval, iamt: d.iamt ?? 0, camt: d.camt ?? 0, samt: d.samt ?? 0, csamt: d.csamt ?? 0, fp }); }
    for (const b of data.b2cs ?? []) rows.push({
      table: "7", doc_type: "INV", pos: b.pos, rt: b.rt, txval: b.txval, iamt: b.iamt ?? 0, camt: b.camt ?? 0, samt: b.samt ?? 0, csamt: b.csamt ?? 0, fp });
    for (const c of data.b2cl ?? []) for (const inv of c.inv ?? []) for (const it of inv.itms ?? []) { const d = det(it); rows.push({
      table: "5", doc_type: "INV", pos: c.pos, inum: inv.inum, idt: inv.idt, val: inv.val, rt: d.rt, txval: d.txval, iamt: d.iamt ?? 0, csamt: d.csamt ?? 0, fp }); }
    return { format: "gstr1_json", rows };
  }
  return null;
}
