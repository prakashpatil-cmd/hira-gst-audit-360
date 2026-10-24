import { validateGstin } from "@/lib/gst/gstin";
import { parseDate, parsePeriod, type DateOrder } from "@/lib/gst/dates";
import { normaliseDocNo, normaliseDocType, docNoIssues, validateHsn, exactDocNo } from "@/lib/gst/documents";
import { toPaise, paiseToDecimal, impliedRate, nearestStandardRate, STANDARD_RATES, taxAtRate } from "@/lib/gst/money";
import { normaliseStateCode } from "@/lib/gst/states";
import type { DatasetDef, FieldDef } from "./datasets";
import type { Cell } from "./parse";

export type Severity = "error" | "warning" | "info";
export interface Issue { code: string; field?: string; message: string; severity: Severity }

export interface ImportOptions {
  dateOrder?: DateOrder;
  /** Treat negative-value invoices as credit notes (common in Tally day-book exports). */
  negativeAsCreditNote?: boolean;
  /** Return period to use when the file has none (e.g. a single-month GSTR-2B). */
  defaultPeriod?: string | null;
}

export interface ImportContext {
  dataset: DatasetDef;
  columnMap: Record<string, string>;
  options: ImportOptions;
  ourGstin: string | null;              // registration selected for this import
  periodFrom: string;                   // engagement window
  periodTo: string;
  tolerancePaise: number;               // per-document tolerance for tax arithmetic checks
}

export interface NormalisedRow {
  status: "accepted" | "warning" | "rejected" | "duplicate";
  issues: Issue[];
  common: {
    doc_type: string | null; doc_no: string | null; doc_no_norm: string | null; doc_date: string | null;
    our_gstin: string | null; counterparty_gstin: string | null; counterparty_name: string | null;
    place_of_supply: string | null; hsn: string | null; rate: number | null;
    taxable_value: string | null; igst: string | null; cgst: string | null; sgst: string | null; cess: string | null;
    total_value: string | null; period: string | null; reverse_charge: boolean | null;
    ledger_name: string | null; voucher_ref: string | null;
  };
  extra: Record<string, string | number | boolean | null>;
  /** Fingerprint used for duplicate detection (document-level datasets only). */
  fingerprint: string | null;
}

const MONEY_COMMON = ["taxable_value", "igst", "cgst", "sgst", "cess", "total_value"] as const;

export function parseBool(v: Cell): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "1", "applicable"].includes(s)) return true;
  if (["n", "no", "false", "0", "not applicable", "na", "-"].includes(s)) return false;
  return null;
}

export function parseRate(v: Cell): number | null {
  if (v == null || v === "") return null;
  const s = String(v).replace("%", "").trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
  if (n > 0 && n < 1) {
    const pct = Math.round(n * 10000) / 100;            // 0.18 → 18 (fraction notation)
    if (pct >= 1 && (STANDARD_RATES as readonly number[]).includes(pct)) return pct;
  }
  return Math.round(n * 1000) / 1000;
}

/** Canonical GSTR-1 / GSTR-2B / GSTR-3B table codes. */
export function normaliseTableCode(returnType: string | undefined, v: Cell): string | null {
  if (v == null) return null;
  const raw = String(v).trim();
  const s = raw.toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (returnType === "GSTR3B") {
    const m = s.match(/^(\d)(?:\.(\d))?\(?([A-E])?\)?(?:\(?(\d)\)?)?/);
    if (m) {
      const [, a, b, c, d] = m;
      if (a === "3" && b) return `3.${b}${c ? `(${c.toLowerCase()})` : ""}`;
      if (a === "4" && c) return `4(${c})${d ? `(${d})` : ""}`;
      if (a === "5" && b) return `5.${b}`;
      if (a === "6" && b) return `6.${b}`;
      return b ? `${a}.${b}` : a;
    }
    return raw;
  }
  if (returnType === "GSTR1" || returnType === "GSTR1A") {
    const map: Record<string, string> = { B2B: "4A", B2BA: "9A-B2B", B2CL: "5", B2CS: "7", EXP: "6A", EXPWP: "6A-WPAY", EXPWOP: "6A-WOPAY",
      SEZWP: "6B-WPAY", SEZWOP: "6B-WOPAY", DE: "6C", CDNR: "9B", CDNUR: "9B-UR", CDNRA: "9C", AT: "11A", ATADJ: "11B", NIL: "8", HSN: "12", DOCS: "13" };
    if (map[s]) return map[s];
    const m = s.match(/^(4A|4B|4C|5|6A|6B|6C|7|8|9A|9B|9C|10|11A|11B|12|13)/);
    if (m) return s.startsWith("6A-") ? s : m[1];
    return s;
  }
  if (returnType === "GSTR2B" || returnType === "GSTR2A") {
    const m = s.match(/^(B2BA|B2B|CDNRA|CDNR|IMPGSEZ|IMPG|ISDA|ISD|ECOA|ECO)/);
    return m ? m[1] : s;
  }
  return s;
}

function get(row: Record<string, Cell>, map: Record<string, string>, key: string): Cell {
  const col = map[key];
  return col ? (row[col] ?? null) : null;
}

/** Validates and normalises one source row. Pure function — no I/O. */
export function normaliseRow(row: Record<string, Cell>, ctx: ImportContext): NormalisedRow {
  const { dataset, columnMap, options } = ctx;
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, message: string, field?: string) => issues.push({ severity, code, message, field });
  const common: NormalisedRow["common"] = {
    doc_type: null, doc_no: null, doc_no_norm: null, doc_date: null, our_gstin: null, counterparty_gstin: null, counterparty_name: null,
    place_of_supply: null, hsn: null, rate: null, taxable_value: null, igst: null, cgst: null, sgst: null, cess: null,
    total_value: null, period: null, reverse_charge: null, ledger_name: null, voucher_ref: null,
  };
  const extra: NormalisedRow["extra"] = {};
  const money: Record<string, number | null> = {};

  for (const fd of dataset.fields) {
    const v = get(row, columnMap, fd.key);
    const blank = v == null || String(v).trim() === "";
    if (blank) {
      if (fd.required) add("error", "REQUIRED_MISSING", `${fd.label} is missing`, fd.key);
      setVal(fd, null);
      continue;
    }
    switch (fd.type) {
      case "text": setVal(fd, String(v).trim()); break;
      case "doctype": setVal(fd, normaliseDocType(v) ?? String(v).trim().toUpperCase()); break;
      case "date": {
        const d = parseDate(v, options.dateOrder);
        if (!d) add(fd.required ? "error" : "warning", "INVALID_DATE", `${fd.label} "${String(v)}" is not a valid date`, fd.key);
        setVal(fd, d);
        break;
      }
      case "datetime": {
        const d = v instanceof Date ? v.toISOString() : parseDate(v, options.dateOrder);
        if (!d) add("warning", "INVALID_DATE", `${fd.label} "${String(v)}" is not a valid date`, fd.key);
        setVal(fd, d);
        break;
      }
      case "period": {
        const p = parsePeriod(v);
        if (!p) add(fd.required ? "error" : "warning", "INVALID_PERIOD", `${fd.label} "${String(v)}" is not a recognisable return period`, fd.key);
        setVal(fd, p);
        break;
      }
      case "money": {
        try { const p = toPaise(v); money[fd.key] = p; setVal(fd, paiseToDecimal(p)); }
        catch { add("error", "INVALID_AMOUNT", `${fd.label} "${String(v)}" is not a valid amount`, fd.key); setVal(fd, null); }
        break;
      }
      case "rate": {
        const r = parseRate(v);
        if (r == null || Number.isNaN(r)) { add("warning", "INVALID_RATE", `${fd.label} "${String(v)}" is not a valid rate`, fd.key); setVal(fd, null); }
        else setVal(fd, r);
        break;
      }
      case "gstin": {
        const g = String(v).trim().toUpperCase();
        if (/^(URP|UNREGISTERED|NA|N\/A|-|0)$/.test(g)) { setVal(fd, null); break; }
        const chk = validateGstin(g);
        if (!chk.valid) add("warning", "INVALID_GSTIN", `${fd.label}: ${chk.reason} (${g})`, fd.key);
        setVal(fd, chk.gstin);
        break;
      }
      case "state": {
        const s = normaliseStateCode(v);
        if (!s) add("warning", "INVALID_STATE", `${fd.label} "${String(v)}" is not a recognisable state`, fd.key);
        setVal(fd, s);
        break;
      }
      case "hsn": {
        const h = validateHsn(v);
        if (!h.ok) add("warning", "INVALID_HSN", `HSN/SAC "${String(v)}": ${h.reason}`, fd.key);
        setVal(fd, h.code || null);
        break;
      }
      case "bool": setVal(fd, parseBool(v)); break;
      case "int": { const n = Number(String(v).replace(/,/g, "")); setVal(fd, Number.isFinite(n) ? Math.round(n) : null); break; }
    }
  }

  function setVal(fd: FieldDef, val: string | number | boolean | null) {
    if (fd.common && fd.key in common) (common as Record<string, unknown>)[fd.key] = val;
    else extra[fd.key] = val;
  }

  // ---- derived values and cross-field checks ------------------------------------------
  const rt = dataset.returnType;
  if (dataset.fields.some((f) => f.key === "table_code")) {
    const tc = normaliseTableCode(rt, extra.table_code as Cell);
    extra.table_code = tc;
    if (!tc && rt && rt !== "GSTR2B" && rt !== "GSTR2A") add("error", "REQUIRED_MISSING", "Return table / section is missing", "table_code");
    if (!tc && (rt === "GSTR2B" || rt === "GSTR2A")) extra.table_code = "B2B";
  }

  // Shipping bills carry the export invoice number: use it as the matching document number.
  if (dataset.target === "shipping_bill" && extra.invoice_no && !common.doc_no) {
    common.doc_no = String(extra.invoice_no);
    common.doc_date = (extra.invoice_date as string | null) ?? null;
  }
  if (dataset.documentLevel && dataset.target !== "ledger") {
    const tc = String(extra.table_code ?? "");
    if (!common.doc_type) {
      common.doc_type = /^9B|^9C|CDNR|CDNUR/.test(tc) ? "CRN" : tc === "IMPG" ? "BOE" : "INV";
    }
    const docNo = common.doc_no ?? (extra.ewb_no as string | null) ?? null;
    if (common.doc_no) {
      common.doc_no = exactDocNo(common.doc_no);
      common.doc_no_norm = normaliseDocNo(common.doc_no);
      if (dataset.target === "sales") for (const m of docNoIssues(common.doc_no)) add("warning", "DOC_NO_FORMAT", m, "doc_no");
    } else if (docNo == null && dataset.target !== "gst_return") {
      // already reported as REQUIRED_MISSING where required
    }
  }

  // Sign conventions: store notes and invoices with positive amounts.
  const negatives = MONEY_COMMON.filter((k) => (money[k] ?? 0) < 0);
  if (negatives.length) {
    const isNote = common.doc_type === "CRN" || common.doc_type === "DBN";
    if (isNote || options.negativeAsCreditNote) {
      if (!isNote) { common.doc_type = "CRN"; add("info", "SIGN_CONVERTED", "Negative invoice treated as a credit note (import option)"); }
      for (const k of MONEY_COMMON) if (money[k] != null) { money[k] = Math.abs(money[k]!); (common as Record<string, unknown>)[k] = paiseToDecimal(money[k]!); }
    } else if (dataset.target !== "ledger" && dataset.target !== "gst_return") {
      add("warning", "NEGATIVE_AMOUNT", `Negative ${negatives.join(", ")} on a ${common.doc_type ?? "document"} — check the sign convention or mark it as a credit note`);
    }
  }
  for (const k of ["itc_igst", "itc_cgst", "itc_sgst", "itc_cess"]) {
    if (typeof extra[k] === "string" && (extra[k] as string).startsWith("-")) extra[k] = (extra[k] as string).slice(1);
  }

  // Our GSTIN must match the registration selected for the import.
  if (common.our_gstin && ctx.ourGstin && common.our_gstin !== ctx.ourGstin) {
    add("error", "GSTIN_MISMATCH", `Row belongs to ${common.our_gstin}, but this import is for ${ctx.ourGstin}`, "our_gstin");
  }
  if (!common.our_gstin && ctx.ourGstin) common.our_gstin = ctx.ourGstin;
  if (common.counterparty_gstin && ctx.ourGstin && common.counterparty_gstin === ctx.ourGstin && dataset.target !== "eway") {
    add("warning", "SELF_GSTIN", "Counterparty GSTIN equals our own GSTIN");
  }

  // Period: default from option, else from document date.
  if (!common.period) {
    if (options.defaultPeriod) common.period = options.defaultPeriod;
    else if (dataset.target !== "gst_return" && common.doc_date) common.period = common.doc_date.slice(0, 8) + "01";
    else if (dataset.target === "gst_return" && dataset.fields.find((f) => f.key === "period")?.required) {
      if (!issues.some((i) => i.field === "period")) add("error", "REQUIRED_MISSING", "Return period is missing", "period");
    }
  }

  // Engagement window — documents dated outside it are flagged, not dropped.
  if (common.doc_date && ["sales", "einvoice", "eway"].includes(dataset.target)) {
    if (common.doc_date < ctx.periodFrom || common.doc_date > ctx.periodTo) {
      add("warning", "OUTSIDE_PERIOD", `Document date ${common.doc_date} is outside the audit period ${ctx.periodFrom} to ${ctx.periodTo}`, "doc_date");
    }
  }
  if (common.doc_date && common.doc_date > new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10)) {
    add("warning", "FUTURE_DATE", "Document date is in the future", "doc_date");
  }

  // Tax arithmetic and tax-head checks.
  const ig = money.igst ?? 0, cg = money.cgst ?? 0, sg = money.sgst ?? 0, tv = money.taxable_value ?? 0;
  if (["sales", "purchase", "gst_return", "einvoice", "eway"].includes(dataset.target) && dataset.returnType !== "GSTR3B") {
    if (ig !== 0 && (cg !== 0 || sg !== 0)) add("warning", "MIXED_TAX_HEADS", "Both IGST and CGST/SGST are charged on the same line");
    if (Math.abs(cg - sg) > ctx.tolerancePaise) add("warning", "CGST_SGST_UNEQUAL", "CGST and SGST amounts differ");
    const tax = ig + cg + sg;
    if (common.rate == null && tv !== 0 && tax !== 0) {
      const ir = impliedRate(tv, tax);
      const std = ir == null ? null : nearestStandardRate(ir);
      if (std != null) common.rate = std;
    }
    if (common.rate != null && tv !== 0) {
      if (!(STANDARD_RATES as readonly number[]).includes(common.rate)) add("warning", "NON_STANDARD_RATE", `Rate ${common.rate}% is not a standard GST rate`, "rate");
      const expected = taxAtRate(tv, common.rate);
      const tol = Math.max(ctx.tolerancePaise, Math.round(Math.abs(tv) * 0.0005));
      if (Math.abs(expected - tax) > tol && !(tax === 0 && isZeroRatedOrExempt(common, extra))) {
        add("warning", "TAX_CALC_DIFF", `Tax ₹${paiseToDecimal(tax)} differs from ${common.rate}% of taxable value (₹${paiseToDecimal(expected)})`, "rate");
      }
    }
    // Place of supply vs tax head (intra-state ⇒ CGST+SGST; inter-state ⇒ IGST), except exports/SEZ/imports.
    const ourState = ctx.ourGstin?.slice(0, 2) ?? null;
    if (common.place_of_supply && ourState && !isZeroRatedOrExempt(common, extra) && dataset.target !== "eway") {
      const intra = common.place_of_supply === ourState;
      if (intra && ig !== 0 && dataset.target === "sales") add("warning", "WRONG_TAX_HEAD", "IGST charged although place of supply is within the state");
      if (!intra && (cg !== 0 || sg !== 0) && dataset.target === "sales") add("warning", "WRONG_TAX_HEAD", "CGST/SGST charged although place of supply is outside the state");
    }
  }
  if (dataset.target === "eway" && (money.cess ?? 0) !== 0 && ig === 0 && cg === 0 && sg === 0) {
    add("warning", "EWB_TAX_IN_CESS", "Tax appears only in the Cess field of the e-way bill (possible IGST mis-mapping)", "cess");
  }

  const errors = issues.some((i) => i.severity === "error");
  const warnings = issues.some((i) => i.severity === "warning");
  const fingerprint = dataset.documentLevel && (common.doc_no_norm || extra.ewb_no || extra.irn || extra.boe_no || extra.sb_no)
    ? [dataset.returnType ?? dataset.target, extra.table_code ?? "", common.doc_type ?? "", common.doc_no_norm ?? extra.ewb_no ?? extra.irn ?? extra.boe_no ?? extra.sb_no,
       common.counterparty_gstin ?? "", common.period ?? "", common.rate ?? "", common.taxable_value ?? "", common.igst ?? "", common.cgst ?? "", common.sgst ?? "",
       common.hsn ?? ""].join("|")
    : null;
  return { status: errors ? "rejected" : warnings ? "warning" : "accepted", issues, common, extra, fingerprint };
}

function isZeroRatedOrExempt(common: NormalisedRow["common"], extra: NormalisedRow["extra"]): boolean {
  const st = String(extra.supply_type ?? "").toLowerCase();
  const tc = String(extra.table_code ?? "");
  return /export|sez|exempt|nil|non.?gst|deemed|zero/.test(st) || /^6[AB]/.test(tc) || tc === "8" || common.place_of_supply === "96" || common.place_of_supply === "97";
}

/** Second pass: marks repeated fingerprints within the same file as duplicates. */
export function markDuplicates(rows: NormalisedRow[], existing: Set<string> = new Set(), rowNumbers?: number[]): void {
  const seen = new Map<string, number>();
  rows.forEach((r, idx) => {
    if (!r.fingerprint || r.status === "rejected") return;
    if (existing.has(r.fingerprint)) {
      r.status = "duplicate";
      r.issues.push({ severity: "warning", code: "DUPLICATE_PREVIOUS_IMPORT", message: "Identical document already committed from an earlier import" });
      return;
    }
    const first = seen.get(r.fingerprint);
    if (first != null) {
      r.status = "duplicate";
      r.issues.push({ severity: "warning", code: "DUPLICATE_IN_FILE", message: `Identical to source row ${rowNumbers ? rowNumbers[first] : first + 1} in this file` });
    } else seen.set(r.fingerprint, idx);
  });
}
