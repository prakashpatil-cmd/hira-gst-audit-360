/**
 * The seven reconciliations of the GST audit. Each is a pure function of the loaded data so the
 * same inputs always give the same matches and exceptions.
 */
import { financialYear, gstr3bDueDateSafe, addMonths } from "./util";
import { formatINR, type Paise } from "@/lib/gst/money";
import { matchDocuments, aggregate, diffOf, type MatchResult, type RDoc } from "./match";
import { itcTimeBarred } from "@/lib/rules/statutory";
import type { ExceptionDraft, GstinData, ReconContext, ReconOutput, ReturnLine, Severity, Classification } from "./types";
import { zeroDiff } from "./types";

const R = (p: Paise) => `₹${formatINR(p)}`;
const fyKey = (d: RDoc) => (d.docDate ? financialYear(d.docDate) : "NA");
const docLabel = (t: string) => (t === "CRN" ? "Credit note" : t === "DBN" ? "Debit note" : t === "BOE" ? "Bill of entry" : "Invoice");
const sign = (d: RDoc) => (d.docType === "CRN" ? -1 : 1);

function ex(partial: Omit<ExceptionDraft, "diff" | "sourceIds"> & { diff?: ExceptionDraft["diff"]; sourceIds?: string[] }): ExceptionDraft {
  return { diff: partial.diff ?? zeroDiff(), sourceIds: partial.sourceIds ?? [], ...partial };
}

function idsOf(m: MatchResult) { return [...(m.left?.ids ?? []), ...(m.right?.ids ?? [])]; }
function head(m: MatchResult) {
  const a = m.left ?? m.right!;
  return { docNo: a.docNo, docDate: a.docDate, gstin: m.left?.gstin ?? m.right?.gstin ?? null, name: a.name, period: (m.left?.periods ?? m.right?.periods ?? [])[0] ?? null };
}

// ===========================================================================================
// 1. Books (sales register) vs GSTR-1
// ===========================================================================================
const GSTR1_DOC_TABLES = /^(4A|4B|4C|5|6A|6B|6C|9A|9B|9C)/;
const isExportish = (d: RDoc) => /export|exp|sez|deemed/i.test(String(d.meta?.supplyType ?? "")) || /^6/.test(String(d.meta?.table ?? "")) || d.meta?.pos === "96";

export function reconBooksVsGstr1(data: GstinData, ctx: ReconContext): ReconOutput {
  const books = [...data.sales, ...data.salesNotes];
  const gstr1Docs = data.gstr1.filter((d) => GSTR1_DOC_TABLES.test(String(d.meta?.table ?? "")) && d.docNoNorm);
  const key = (d: RDoc) => `${fyKey(d)}|${d.docType}|${d.docNoNorm}`;
  const all = matchDocuments(books, gstr1Docs, { tolerancePaise: ctx.tolerance, key, fuzzy: true });

  // Unregistered (B2C) supplies not found invoice-wise are compared in aggregate with Table 7 (B2CS).
  const b2cPool: RDoc[] = [];
  const matches: MatchResult[] = [];
  for (const m of all) {
    if (m.status === "left_only" && !m.left!.gstin && !isExportish(m.left!.docs[0])) b2cPool.push(...m.left!.docs);
    else matches.push(m);
  }
  const exceptions: ExceptionDraft[] = [];
  matches.forEach((m, i) => {
    const h = head(m);
    const t = (m.left ?? m.right)!.docType;
    const base = { module: "B", matchIndex: i, sourceIds: idsOf(m), ...h, diff: m.diff };
    switch (m.status) {
      case "left_only":
        exceptions.push(ex({ ...base, controlId: null,
          type: t === "CRN" ? "CN_NOT_IN_GSTR1" : "MISSING_IN_GSTR1",
          severity: t === "CRN" ? "low" : isExportish(m.left!.docs[0]) ? "high" : m.left!.tax > 0 ? "high" : "medium",
          classification: t === "CRN" ? "potential_opportunity" : "probable",
          description: t === "CRN"
            ? `${docLabel(t)} ${h.docNo} (${R(m.left!.tax)} tax) is in the books but not in GSTR-1; the reduction in liability has not been claimed.`
            : `${docLabel(t)} ${h.docNo} dated ${h.docDate ?? "—"} (taxable ${R(m.left!.taxable)}, tax ${R(m.left!.tax)}) is recorded in the books but not reported in GSTR-1.` }));
        break;
      case "right_only":
        exceptions.push(ex({ ...base, type: t === "CRN" ? "CN_IN_GSTR1_NOT_IN_BOOKS" : "MISSING_IN_BOOKS",
          severity: t === "CRN" ? "high" : "medium", classification: "requires_investigation",
          description: t === "CRN"
            ? `Credit note ${h.docNo} reduces liability in GSTR-1 by ${R(m.right!.tax)} but is not recorded in the books.`
            : `${docLabel(t)} ${h.docNo} is reported in GSTR-1 (taxable ${R(m.right!.taxable)}) but is not in the sales register.` }));
        break;
      case "value_mismatch":
      case "tax_mismatch": {
        const under = m.diff.tax > 0 || (m.diff.tax === 0 && m.diff.taxable > 0);
        exceptions.push(ex({ ...base, type: under ? "UNDER_REPORTED_IN_GSTR1" : "OVER_REPORTED_IN_GSTR1",
          severity: under ? (t === "CRN" ? "low" : "high") : t === "CRN" ? "high" : "low", classification: "probable",
          description: `${docLabel(t)} ${h.docNo}: books taxable ${R(m.left!.taxable)} / tax ${R(m.left!.tax)} against GSTR-1 taxable ${R(m.right!.taxable)} / tax ${R(m.right!.tax)}.` }));
        break;
      }
      case "gstin_mismatch":
        exceptions.push(ex({ ...base, type: "GSTIN_MISMATCH", severity: "medium", classification: "probable",
          description: `${docLabel(t)} ${h.docNo}: recipient GSTIN in books ${m.left!.gstin ?? "—"} differs from GSTIN reported in GSTR-1 ${m.right!.gstin ?? "—"}; the recipient's credit is at risk.` }));
        break;
      case "matched_fuzzy":
        exceptions.push(ex({ ...base, type: "DOC_NUMBER_VARIANT", severity: "low", classification: "requires_investigation",
          description: `Books ${m.left!.docNo} and GSTR-1 ${m.right!.docNo} appear to be the same document (same customer, amount and date) with different numbering.` }));
        break;
      case "duplicate_left":
        exceptions.push(ex({ ...base, type: "DUPLICATE_IN_BOOKS", severity: "medium", classification: "requires_investigation",
          description: `${docLabel(t)} ${h.docNo} is recorded more than once in the sales register (repeat lines: tax ${R(m.left!.tax)}).` }));
        break;
      case "duplicate_right":
        exceptions.push(ex({ ...base, type: "DUPLICATE_IN_GSTR1", severity: "medium", classification: "potential_opportunity",
          description: `${docLabel(t)} ${h.docNo} is reported more than once in GSTR-1 (excess tax ${R(m.right!.tax)}).` }));
        break;
    }
    if (m.left && m.right && m.flags.includes("HEAD_MISMATCH")) {
      exceptions.push(ex({ ...base, type: "TAX_HEAD_MISMATCH", severity: "high", classification: "probable",
        description: `${docLabel(t)} ${h.docNo}: tax head in GSTR-1 (IGST ${R(m.right.igst)}, CGST+SGST ${R(m.right.cgst + m.right.sgst)}) differs from books (IGST ${R(m.left.igst)}, CGST+SGST ${R(m.left.cgst + m.left.sgst)}).` }));
    }
    if (m.left && m.right && m.flags.includes("PERIOD_MISMATCH") && m.status !== "value_mismatch") {
      const lp = m.left.periods[0], rp = m.right.periods[0];
      if (lp && rp && rp > lp) exceptions.push(ex({ ...base, type: "REPORTED_LATE_IN_GSTR1", severity: "low", classification: "confirmed",
        description: `${docLabel(t)} ${h.docNo} for ${lp.slice(0, 7)} was reported in the GSTR-1 for ${rp.slice(0, 7)}; interest may apply if tax was discharged late.` }));
    }
  });

  // B2CS aggregate comparison: period | place of supply | rate
  const t7 = data.gstr1.filter((d) => String(d.meta?.table ?? "") === "7");
  const bucket = (d: RDoc) => `${d.period ?? "NA"}|${String(d.meta?.pos ?? "")}|${d.rate ?? ""}`;
  const pb = new Map<string, RDoc[]>(), pr = new Map<string, RDoc[]>();
  for (const d of b2cPool) (pb.get(bucket(d)) ?? pb.set(bucket(d), []).get(bucket(d))!).push(d);
  for (const d of t7) (pr.get(bucket(d)) ?? pr.set(bucket(d), []).get(bucket(d))!).push(d);
  for (const k of Array.from(new Set([...pb.keys(), ...pr.keys()])).sort()) {
    const l = pb.get(k), r = pr.get(k);
    const signed = (docs?: RDoc[]) => docs ? aggregate(docs.map((d) => ({ ...d, taxable: sign(d) * d.taxable, igst: sign(d) * d.igst, cgst: sign(d) * d.cgst, sgst: sign(d) * d.sgst, cess: sign(d) * d.cess }))) : null;
    const la = signed(l), ra = signed(r);
    const diff = diffOf(la, ra);
    if (Math.abs(diff.taxable) <= ctx.tolerance && Math.abs(diff.tax) <= ctx.tolerance) continue;
    const [period, pos, rate] = k.split("|");
    const m: MatchResult = { key: `B2CS|${k}`, status: !la ? "right_only" : !ra ? "left_only" : diff.taxable === 0 ? "tax_mismatch" : "value_mismatch",
      method: "none", left: la, right: ra, diff, flags: [] };
    matches.push(m);
    exceptions.push(ex({ module: "B", type: diff.tax > 0 ? "B2C_UNDER_REPORTED" : "B2C_OVER_REPORTED", severity: diff.tax > 0 ? "high" : "low",
      classification: "probable", period: period === "NA" ? null : period, matchIndex: matches.length - 1, sourceIds: idsOf(m), diff,
      description: `B2C supplies (POS ${pos || "—"}, rate ${rate || "—"}%) for ${period.slice(0, 7)}: books taxable ${R(la?.taxable ?? 0)} vs GSTR-1 Table 7 ${R(ra?.taxable ?? 0)}; tax difference ${R(diff.tax)}.` }));
  }
  return { matches, exceptions, summary: { books: books.length, gstr1: gstr1Docs.length, b2cAggregates: pb.size } };
}

// ===========================================================================================
// 2. GSTR-1 vs GSTR-3B (period-wise liability by tax head)
// ===========================================================================================
type Heads = { taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise };
const H0 = (): Heads => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const addH = (a: Heads, b: Heads, s = 1) => { a.taxable += s * b.taxable; a.igst += s * b.igst; a.cgst += s * b.cgst; a.sgst += s * b.sgst; a.cess += s * b.cess; };
const taxH = (h: Heads) => h.igst + h.cgst + h.sgst + h.cess;

export function gstr1LiabilityByPeriod(gstr1: RDoc[]) {
  const m = new Map<string, Heads & { ids: string[] }>();
  for (const d of gstr1) {
    const t = String(d.meta?.table ?? "");
    if (!d.period || /^(8|12|13)$/.test(t)) continue;
    const s = t === "11B" || d.docType === "CRN" ? -1 : 1;
    const h = m.get(d.period) ?? Object.assign(H0(), { ids: [] as string[] });
    addH(h, d, s); h.ids.push(d.id);
    m.set(d.period, h);
  }
  return m;
}

export function gstr3bOutwardByPeriod(lines: ReturnLine[]) {
  const m = new Map<string, Heads & { ids: string[] }>();
  for (const l of lines) {
    if (!/^3\.1\((a|b)\)$/.test(l.table)) continue;
    const h = m.get(l.period) ?? Object.assign(H0(), { ids: [] as string[] });
    addH(h, l); h.ids.push(l.id);
    m.set(l.period, h);
  }
  return m;
}

export function reconGstr1VsGstr3b(data: GstinData, ctx: ReconContext): ReconOutput {
  const g1 = gstr1LiabilityByPeriod(data.gstr1);
  const g3 = gstr3bOutwardByPeriod(data.gstr3b);
  const periods = Array.from(new Set([...g1.keys(), ...g3.keys()])).sort();
  const matches: MatchResult[] = [];
  const exceptions: ExceptionDraft[] = [];
  const rows = periods.map((p) => {
    const a = g1.get(p) ?? Object.assign(H0(), { ids: [] }), b = g3.get(p) ?? Object.assign(H0(), { ids: [] });
    const diff = { taxable: a.taxable - b.taxable, igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst, cess: a.cess - b.cess, tax: taxH(a) - taxH(b) };
    return { p, a, b, diff };
  });
  // Timing differences: a shortfall in one month offset by an excess within the next two months.
  const timing = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].diff.tax <= ctx.tolerance) continue;
    for (let j = i + 1; j < Math.min(rows.length, i + 3); j++) {
      if (rows[j].diff.tax < -ctx.tolerance && Math.abs(rows[i].diff.tax + rows[j].diff.tax) <= Math.max(ctx.tolerance, Math.round(rows[i].diff.tax * 0.02))) {
        timing.add(rows[i].p); timing.add(rows[j].p);
      }
    }
  }
  for (const r of rows) {
    const mk = (h: Heads & { ids: string[] }, ids: string[]) => ({ docType: "SUM", docNo: `Period ${r.p.slice(0, 7)}`, docNoNorm: r.p, docDate: null,
      gstin: null, name: null, periods: [r.p], rates: [], taxable: h.taxable, igst: h.igst, cgst: h.cgst, sgst: h.sgst, cess: h.cess, ids, tax: taxH(h), docs: [] });
    const ok = Math.abs(r.diff.tax) <= ctx.tolerance && Math.abs(r.diff.taxable) <= ctx.tolerance * 10;
    const headOk = [r.diff.igst, r.diff.cgst, r.diff.sgst, r.diff.cess].every((x) => Math.abs(x) <= ctx.tolerance);
    const m: MatchResult = { key: r.p, status: ok && headOk ? "matched" : ok ? "tax_mismatch" : "value_mismatch", method: "exact",
      left: mk(r.a, r.a.ids), right: mk(r.b, r.b.ids), diff: r.diff, flags: !headOk && Math.abs(r.diff.tax) <= ctx.tolerance ? ["HEAD_MISMATCH"] : [] };
    matches.push(m);
    const idx = matches.length - 1;
    const base = { module: "B", period: r.p, matchIndex: idx, sourceIds: [...r.a.ids, ...r.b.ids], diff: r.diff };
    if (ok && headOk) continue;
    if (!headOk && Math.abs(r.diff.tax) <= ctx.tolerance) {
      exceptions.push(ex({ ...base, type: "TAX_HEAD_MISMATCH_3B", severity: "high", classification: "probable",
        description: `${r.p.slice(0, 7)}: total tax agrees but the split between IGST and CGST/SGST in GSTR-3B differs from GSTR-1 (IGST difference ${R(r.diff.igst)}).` }));
    } else if (timing.has(r.p)) {
      exceptions.push(ex({ ...base, type: "TIMING_DIFFERENCE", severity: "medium", classification: "probable",
        description: `${r.p.slice(0, 7)}: GSTR-1 tax ${R(taxH(r.a))} vs GSTR-3B ${R(taxH(r.b))} — offset in an adjoining month; interest under Section 50(1) applies for the period of delay on ${R(Math.max(0, r.diff.tax))}.` }));
    } else if (r.diff.tax > ctx.tolerance || (r.diff.tax >= -ctx.tolerance && r.diff.taxable > ctx.tolerance * 10)) {
      exceptions.push(ex({ ...base, type: "LIABILITY_SHORT_IN_3B", severity: r.diff.tax >= ctx.materiality ? "high" : "medium", classification: "probable",
        description: `${r.p.slice(0, 7)}: liability declared in GSTR-3B (${R(taxH(r.b))}) is lower than GSTR-1 (${R(taxH(r.a))}) by ${R(r.diff.tax)}; taxable value difference ${R(r.diff.taxable)}. Due date ${gstr3bDueDateSafe(r.p)}.` }));
    } else {
      exceptions.push(ex({ ...base, type: "LIABILITY_EXCESS_IN_3B", severity: "opportunity", classification: "potential_opportunity",
        description: `${r.p.slice(0, 7)}: GSTR-3B liability exceeds GSTR-1 by ${R(-r.diff.tax)} (taxable ${R(-r.diff.taxable)}) — excess payment or unreported outward supplies; investigate before adjusting.` }));
    }
  }
  const tot = rows.reduce((s, r) => ({ g1: s.g1 + taxH(r.a), g3: s.g3 + taxH(r.b) }), { g1: 0, g3: 0 });
  return { matches, exceptions, summary: { periods: periods.length, gstr1Tax: tot.g1, gstr3bTax: tot.g3, difference: tot.g1 - tot.g3, timingPeriods: Array.from(timing) } };
}

// ===========================================================================================
// 3. Purchase register vs GSTR-2B vs GSTR-3B
// ===========================================================================================
const itcOf = (d: RDoc) => Number(d.meta?.itcTotal ?? 0);
const NOT_CLAIMABLE = /inelig|blocked|not\s*claim|17\(5\)/i;

export function reconPrVs2bVs3b(data: GstinData, ctx: ReconContext): ReconOutput {
  // Import documents arrive keyed by bill-of-entry number (the loader sets docType BOE).
  const books = [...data.purchases, ...data.purchaseNotes].filter((d) => !d.meta?.rcm);
  const twoB = data.gstr2b.filter((d) => !d.meta?.rcm && String(d.meta?.table ?? "") !== "ISD");
  const key = (d: RDoc) => d.docType === "BOE" ? `BOE|${d.docNoNorm}` : `${d.gstin ?? "NA"}|${d.docType}|${fyKey(d)}|${d.docNoNorm}`;
  const keyWithoutGstin = (d: RDoc) => `${d.docType}|${d.docDate ?? ""}|${d.docNoNorm}`;
  const matches = matchDocuments(books, twoB, { tolerancePaise: ctx.tolerance, key, keyWithoutGstin, fuzzy: true });
  const exceptions: ExceptionDraft[] = [];
  const boeOnFile = new Set(data.boe.map((b) => b.boeNorm));
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  matches.forEach((m, i) => {
    const h = head(m);
    const base = { module: "C", matchIndex: i, sourceIds: idsOf(m), ...h };
    const claimed = m.left ? m.left.docs.reduce((s, d) => s + itcOf(d), 0) : 0;
    const category = String(m.left?.docs[0]?.meta?.category ?? "");
    const claimPeriod = (m.left?.docs[0]?.meta?.claimPeriod as string | null) ?? null;
    const t = (m.left ?? m.right)!.docType;
    const isNote = t === "CRN";
    if (m.status === "duplicate_left") {
      bump("duplicate_itc");
      if (claimed > 0) exceptions.push(ex({ ...base, type: "DUPLICATE_ITC", controlId: null, severity: "high", classification: "probable",
        diff: { ...zeroDiff(), tax: claimed, igst: sumMeta(m.left!.docs, "itcIgst"), cgst: sumMeta(m.left!.docs, "itcCgst"), sgst: sumMeta(m.left!.docs, "itcSgst") },
        description: `${docLabel(t)} ${h.docNo} from ${h.gstin ?? "supplier"} is booked more than once; duplicate ITC of ${R(claimed)} claimed.` }));
      return;
    }
    if (m.status === "duplicate_right") { bump("duplicate_2b"); return; }
    if (m.status === "left_only") {
      bump("books_only");
      // Import of goods: Section 16(2)(aa) does not govern bills of entry. Where the bill of entry is on file the
      // imports reconciliation (module J) reports it; otherwise flag it for verification against ICEGATE.
      if (t === "BOE") {
        const boeNo = String(m.left!.docs[0].meta?.boeNoNorm ?? m.left!.docs[0].docNoNorm);
        if (claimed > ctx.tolerance && !boeOnFile.has(boeNo)) exceptions.push(ex({ ...base, type: "CLAIMED_NOT_IN_2B", severity: "medium", classification: "requires_investigation",
          diff: itcDiff(m.left!.docs),
          description: `IGST credit of ${R(claimed)} claimed on bill of entry ${h.docNo}, which is not reflected in GSTR-2B (IMPG) and no bill of entry record has been provided — verify against ICEGATE.` }));
        return;
      }
      if (claimed > ctx.tolerance && !isNote) exceptions.push(ex({ ...base, type: "CLAIMED_NOT_IN_2B", severity: "high", classification: "probable",
        diff: itcDiff(m.left!.docs),
        description: `ITC of ${R(claimed)} claimed on ${docLabel(t).toLowerCase()} ${h.docNo} (${h.name ?? h.gstin ?? "supplier"}) which does not appear in GSTR-2B — Section 16(2)(aa).` }));
      return;
    }
    if (m.status === "right_only") {
      bump("2b_only");
      const r = m.right!;
      const avl = r.docs[0]?.meta?.itcAvailable;
      if (isNote) exceptions.push(ex({ ...base, type: "SUPPLIER_CN_NOT_BOOKED", severity: "high", classification: "probable", diff: diffOf(r, null),
        description: `Supplier credit note ${h.docNo} (${h.name ?? h.gstin}) in GSTR-2B reduces eligible ITC by ${R(r.tax)} but is not recorded in the books; ITC must be reversed.` }));
      else if (avl !== false && r.tax > ctx.tolerance) {
        const bar = r.docDate ? itcTimeBarred(r.docDate, null, ctx.asOf, ctx.annualReturnFiledOn) : null;
        exceptions.push(ex({ ...base, type: bar?.barred ? "IN_2B_NOT_IN_BOOKS_TIME_BARRED" : "IN_2B_NOT_IN_BOOKS",
          severity: bar?.barred ? "low" : "opportunity", classification: bar?.barred ? "requires_investigation" : "potential_opportunity", diff: diffOf(r, null),
          description: `${docLabel(t)} ${h.docNo} from ${h.name ?? h.gstin} with ITC ${R(r.tax)} is in GSTR-2B but not in the purchase register` +
            (bar ? (bar.barred ? `; the Section 16(4) cut-off (${bar.cutoff}) has passed.` : `; credit may be claimed by ${bar.cutoff} if eligible.`) : ".") }));
      }
      return;
    }
    // Both sides present
    bump(m.status);
    const r = m.right!;
    const avl = r.docs[0]?.meta?.itcAvailable;
    if (m.status === "gstin_mismatch") exceptions.push(ex({ ...base, type: "SUPPLIER_GSTIN_MISMATCH", severity: "medium", classification: "probable", diff: m.diff,
      description: `${docLabel(t)} ${h.docNo}: supplier GSTIN in books ${m.left!.gstin ?? "—"} differs from GSTR-2B ${r.gstin ?? "—"}.` }));
    if (m.status === "matched_fuzzy") exceptions.push(ex({ ...base, type: "DOC_NUMBER_VARIANT", severity: "low", classification: "requires_investigation", diff: m.diff,
      description: `Books ${m.left!.docNo} matched to GSTR-2B ${r.docNo} on supplier, date and amount; correct the document number in the books.` }));
    if (claimed > 0 && avl === false) {
      exceptions.push(ex({ ...base, type: "CLAIMED_ITC_NOT_AVAILABLE", severity: "high", classification: "probable", diff: itcDiff(m.left!.docs),
        description: `ITC of ${R(claimed)} claimed on ${h.docNo} although GSTR-2B marks the document as ITC not available${r.docs[0]?.meta?.reason ? ` (${r.docs[0].meta.reason})` : ""}.` }));
    } else if (claimed > r.tax + ctx.tolerance && !isNote) {
      exceptions.push(ex({ ...base, type: "EXCESS_ITC_OVER_2B", severity: "high", classification: "probable",
        diff: { ...zeroDiff(), tax: claimed - r.tax, igst: sumMeta(m.left!.docs, "itcIgst") - r.igst, cgst: sumMeta(m.left!.docs, "itcCgst") - r.cgst, sgst: sumMeta(m.left!.docs, "itcSgst") - r.sgst },
        description: `${h.docNo}: ITC claimed ${R(claimed)} exceeds tax in GSTR-2B ${R(r.tax)} by ${R(claimed - r.tax)}.` }));
    } else if (claimed <= ctx.tolerance && r.tax > ctx.tolerance && !NOT_CLAIMABLE.test(category) && !isNote) {
      const bar = itcTimeBarred(m.left!.docDate ?? r.docDate ?? ctx.asOf, null, ctx.asOf, ctx.annualReturnFiledOn);
      exceptions.push(ex({ ...base, type: bar.barred ? "UNCLAIMED_ITC_TIME_BARRED" : "MATCHED_UNCLAIMED",
        severity: bar.barred ? "low" : "opportunity", classification: bar.barred ? "requires_investigation" : "potential_opportunity", diff: diffOf(r, null),
        description: `${h.docNo} (${h.name ?? h.gstin}): eligible ITC of ${R(r.tax)} appears in GSTR-2B and the books but has not been claimed` +
          (bar.barred ? `; Section 16(4) cut-off ${bar.cutoff} has passed.` : `; claim before ${bar.cutoff}.`) }));
    } else if (m.status === "value_mismatch" || m.status === "tax_mismatch") {
      exceptions.push(ex({ ...base, type: "ITC_VALUE_MISMATCH", severity: "medium", classification: "requires_investigation", diff: m.diff,
        description: `${h.docNo}: books taxable ${R(m.left!.taxable)} / tax ${R(m.left!.tax)} vs GSTR-2B taxable ${R(r.taxable)} / tax ${R(r.tax)}.` }));
    }
    if (claimed > 0 && m.left!.docDate) {
      const bar = itcTimeBarred(m.left!.docDate, claimPeriod, ctx.asOf, ctx.annualReturnFiledOn);
      if (bar.barred && claimPeriod) exceptions.push(ex({ ...base, type: "ITC_TIME_BARRED", severity: "high", classification: "probable", diff: itcDiff(m.left!.docs),
        description: `ITC of ${R(claimed)} on ${h.docNo} dated ${m.left!.docDate} was claimed in the return for ${claimPeriod.slice(0, 7)}, after the Section 16(4) cut-off of ${bar.cutoff}.` }));
    }
  });

  // Period-wise: ITC per books (by claim period) vs GSTR-3B Table 4(A), and GSTR-2B vs 4(A)(5).
  const booksByPeriod = new Map<string, number>();
  for (const d of data.purchases) {
    const p = (d.meta?.claimPeriod as string | null) ?? d.period;
    if (!p) continue;
    const s = d.docType === "CRN" ? -1 : 1;
    booksByPeriod.set(p, (booksByPeriod.get(p) ?? 0) + s * itcOf(d));
  }
  for (const d of data.purchaseNotes) {
    const p = (d.meta?.claimPeriod as string | null) ?? d.period;
    if (p && d.docType === "CRN") booksByPeriod.set(p, (booksByPeriod.get(p) ?? 0) - itcOf(d));
  }
  const twoBByPeriod = new Map<string, number>();
  for (const d of data.gstr2b) {
    if (!d.period || d.meta?.itcAvailable === false || d.meta?.rcm) continue;
    if (/^(IMPG|ISD)/.test(String(d.meta?.table ?? ""))) continue;
    twoBByPeriod.set(d.period, (twoBByPeriod.get(d.period) ?? 0) + (d.docType === "CRN" ? -1 : 1) * (d.igst + d.cgst + d.sgst + d.cess));
  }
  const t4a = new Map<string, { all: number; a5: number; ids: string[] }>();
  for (const l of data.gstr3b) {
    if (!/^4\(A\)/.test(l.table)) continue;
    const v = t4a.get(l.period) ?? { all: 0, a5: 0, ids: [] };
    const tx = l.igst + l.cgst + l.sgst + l.cess;
    v.all += tx; if (l.table === "4(A)(5)") v.a5 += tx;
    v.ids.push(l.id);
    t4a.set(l.period, v);
  }
  const periodRows: { period: string; books: number; twoB: number; t4a: number; t4a5: number }[] = [];
  for (const p of Array.from(new Set([...booksByPeriod.keys(), ...t4a.keys(), ...twoBByPeriod.keys()])).sort()) {
    const b = booksByPeriod.get(p) ?? 0, a = t4a.get(p), two = twoBByPeriod.get(p) ?? 0;
    periodRows.push({ period: p, books: b, twoB: two, t4a: a?.all ?? 0, t4a5: a?.a5 ?? 0 });
    if (!a) continue;
    if (a.a5 - two > Math.max(ctx.tolerance * 10, ctx.materiality / 10)) exceptions.push(ex({ module: "C", type: "ITC_3B_EXCEEDS_2B", severity: "high", classification: "probable",
      period: p, sourceIds: a.ids, diff: { ...zeroDiff(), tax: a.a5 - two },
      description: `${p.slice(0, 7)}: ITC claimed in GSTR-3B Table 4(A)(5) ${R(a.a5)} exceeds ITC available in GSTR-2B ${R(two)} by ${R(a.a5 - two)}.` }));
    if (Math.abs(a.all - b) > Math.max(ctx.tolerance * 10, ctx.materiality / 10)) exceptions.push(ex({ module: "C", type: "ITC_BOOKS_VS_3B", severity: "medium",
      classification: "requires_investigation", period: p, sourceIds: a.ids, diff: { ...zeroDiff(), tax: a.all - b },
      description: `${p.slice(0, 7)}: ITC per GSTR-3B Table 4(A) ${R(a.all)} vs ITC per books ${R(b)} (difference ${R(a.all - b)}).` }));
  }
  return { matches, exceptions, summary: { counts, periods: periodRows } };
}

function sumMeta(docs: RDoc[], k: string) { return docs.reduce((s, d) => s + Number(d.meta?.[k] ?? 0), 0); }
function itcDiff(docs: RDoc[]) {
  const igst = sumMeta(docs, "itcIgst"), cgst = sumMeta(docs, "itcCgst"), sgst = sumMeta(docs, "itcSgst"), cess = sumMeta(docs, "itcCess");
  return { taxable: docs.reduce((s, d) => s + d.taxable, 0), igst, cgst, sgst, cess, tax: igst + cgst + sgst + cess };
}

// ===========================================================================================
// 4. E-invoice vs GSTR-1 vs books
// ===========================================================================================
export function reconEinvoice(data: GstinData, ctx: ReconContext): ReconOutput {
  const active = data.einv.filter((d) => d.meta?.status !== "CNL");
  const cancelled = data.einv.filter((d) => d.meta?.status === "CNL");
  const key = (d: RDoc) => `${fyKey(d)}|${d.docType}|${d.docNoNorm}`;
  const gstr1Docs = data.gstr1.filter((d) => GSTR1_DOC_TABLES.test(String(d.meta?.table ?? "")) && d.docNoNorm);
  const vsG1 = matchDocuments(active, gstr1Docs.filter((d) => d.gstin || /^6/.test(String(d.meta?.table ?? ""))), { tolerancePaise: ctx.tolerance, key });
  const vsBooks = matchDocuments(active, [...data.sales, ...data.salesNotes].filter((d) => d.gstin || isExportish(d)), { tolerancePaise: ctx.tolerance, key });
  const matches: MatchResult[] = [];
  const exceptions: ExceptionDraft[] = [];
  for (const m of vsG1) {
    matches.push(m);
    const i = matches.length - 1, h = head(m);
    if (m.status === "left_only") exceptions.push(ex({ module: "F", type: "IRN_NOT_IN_GSTR1", severity: "high", classification: "probable", matchIndex: i, sourceIds: idsOf(m), ...h,
      diff: m.diff, description: `E-invoice (IRN) generated for ${h.docNo} dated ${h.docDate} (taxable ${R(m.left!.taxable)}, tax ${R(m.left!.tax)}) but the supply is not reported in GSTR-1.` }));
    else if (m.status === "value_mismatch" || m.status === "tax_mismatch") exceptions.push(ex({ module: "F", type: "IRN_GSTR1_VALUE_MISMATCH", severity: "medium",
      classification: "probable", matchIndex: i, sourceIds: idsOf(m), ...h, diff: m.diff,
      description: `${h.docNo}: e-invoice taxable ${R(m.left!.taxable)} vs GSTR-1 ${R(m.right!.taxable)} (tax difference ${R(m.diff.tax)}).` }));
    else if (m.status === "right_only" && ctx.einvoiceFrom && h.docDate && h.docDate >= ctx.einvoiceFrom) exceptions.push(ex({ module: "F", type: "GSTR1_WITHOUT_IRN",
      severity: "high", classification: "probable", matchIndex: i, sourceIds: idsOf(m), ...h, diff: zeroDiff(),
      description: `${h.docNo} (B2B/export) is reported in GSTR-1 without a matching active IRN although e-invoicing applies from ${ctx.einvoiceFrom}.` }));
  }
  for (const m of vsBooks) {
    if (m.status !== "left_only") continue;
    matches.push(m);
    const h = head(m);
    exceptions.push(ex({ module: "F", type: "IRN_NOT_IN_BOOKS", severity: "medium", classification: "requires_investigation", matchIndex: matches.length - 1,
      sourceIds: idsOf(m), ...h, diff: m.diff, description: `IRN exists for ${h.docNo} dated ${h.docDate} but no invoice with that number is recorded in the sales register.` }));
  }
  // Cancelled IRNs whose documents remain in GSTR-1
  const g1Keys = new Map(gstr1Docs.map((d) => [key(d), d]));
  for (const c of cancelled) {
    const g = g1Keys.get(key(c));
    if (g && !active.some((a) => key(a) === key(c))) exceptions.push(ex({ module: "F", type: "CANCELLED_IRN_REPORTED", severity: "medium", classification: "requires_investigation",
      docNo: c.docNo, docDate: c.docDate, gstin: c.gstin, sourceIds: [c.id, g.id], diff: zeroDiff(),
      description: `IRN for ${c.docNo} is cancelled on the IRP but the document is still reported in GSTR-1.` }));
  }
  // IRN reporting delay (30-day limit for notified AATO classes)
  const limitApplies = (ctx.aatoCrore ?? 0) >= 10;
  if (limitApplies) for (const e of active) {
    const ack = e.meta?.ackDate as string | null;
    if (ack && e.docDate && daysDiff(e.docDate, ack.slice(0, 10)) > 30) exceptions.push(ex({ module: "F",
      type: "IRN_REPORTED_LATE", severity: "medium", classification: "probable", docNo: e.docNo, docDate: e.docDate, gstin: e.gstin, sourceIds: [e.id],
      description: `IRN for ${e.docNo} was generated on ${ack.slice(0, 10)}, more than 30 days after the document date ${e.docDate} (applicable time limit for the taxpayer's AATO class — verify notification).` }));
  }
  return { matches, exceptions, summary: { irnActive: active.length, irnCancelled: cancelled.length } };
}

function daysDiff(a: string, b: string) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

// ===========================================================================================
// 5. E-way bills vs sales (and stock movement)
// ===========================================================================================
const NON_SUPPLY_SUBTYPES = /job|sku|skd|exhibition|line sales|recipient not known|own use|for own|others|branch|stock transfer/i;

export function reconEwayBills(data: GstinData, ctx: ReconContext): ReconOutput {
  const outward = data.ewb.filter((d) => d.meta?.direction !== "inward");
  const active = outward.filter((d) => d.meta?.status === "active" || d.meta?.status === "expired");
  const key = (d: RDoc) => `${fyKey(d)}|${d.docNoNorm}`;
  const sales = data.sales.filter((d) => d.docType === "INV");
  const res = matchDocuments(active.map((d) => ({ ...d, docType: "INV" })), sales, { tolerancePaise: Math.max(ctx.tolerance, 100), key });
  const matches: MatchResult[] = [];
  const exceptions: ExceptionDraft[] = [];
  const salesKeys = new Set(sales.map(key));
  for (const m of res) {
    matches.push(m);
    const i = matches.length - 1, h = head(m);
    const base = { module: "G", matchIndex: i, sourceIds: idsOf(m), ...h };
    if (m.status === "duplicate_left") exceptions.push(ex({ ...base, type: "MULTIPLE_EWB_ONE_DOC", severity: "low", classification: "requires_investigation",
      description: `More than one active e-way bill exists for document ${h.docNo}.` }));
    else if (m.status === "left_only") {
      const sub = String(m.left!.docs[0]?.meta?.subType ?? "");
      const nonSupply = NON_SUPPLY_SUBTYPES.test(sub);
      exceptions.push(ex({ ...base, type: nonSupply ? "EWB_NON_SUPPLY_MOVEMENT" : "EWB_WITHOUT_SALE", severity: nonSupply ? "low" : "medium",
        classification: nonSupply ? "documentary_deficiency" : "requires_investigation", diff: m.diff,
        description: nonSupply
          ? `E-way bill for ${h.docNo} (${sub}) covers movement otherwise than by way of supply — verify delivery challan and return of goods.`
          : `Active e-way bill for document ${h.docNo} dated ${h.docDate ?? "—"} (taxable ${R(m.left!.taxable)}) has no corresponding invoice in the sales register.` }));
    } else if (m.status === "value_mismatch" || m.status === "tax_mismatch") exceptions.push(ex({ ...base, type: "EWB_VALUE_MISMATCH", severity: "medium",
      classification: "probable", diff: m.diff, description: `E-way bill for ${h.docNo}: taxable ${R(m.left!.taxable)}, tax ${R(m.left!.tax)} vs invoice taxable ${R(m.right!.taxable)}, tax ${R(m.right!.tax)}.` }));
    if (m.left && m.right && m.flags.includes("HEAD_MISMATCH")) exceptions.push(ex({ ...base, type: "EWB_TAX_HEAD_MISMATCH", severity: "medium", classification: "probable",
      description: `E-way bill for ${h.docNo} declares tax under a different head (IGST ${R(m.left.igst)}, CGST+SGST ${R(m.left.cgst + m.left.sgst)}, cess ${R(m.left.cess)}) from the invoice.` }));
  }
  // Tax entered in the cess field instead of IGST
  const inCess = outward.filter((d) => d.cess > 0 && d.igst + d.cgst + d.sgst === 0 && d.meta?.status !== "cancelled");
  if (inCess.length) {
    const total = inCess.reduce((s, d) => s + d.cess, 0);
    exceptions.push(ex({ module: "G", type: "EWB_TAX_IN_CESS", severity: "high", classification: "confirmed", sourceIds: inCess.map((d) => d.id),
      diff: { ...zeroDiff(), cess: total, tax: 0 },
      description: `${inCess.length} e-way bill(s) declare tax of ${R(total)} in the Cess field instead of IGST/CGST/SGST; the documents misstate the tax head and are exposed to detention under Section 129.` }));
  }
  // Discarded / cancelled e-way bills with tax that still have invoices
  const voided = outward.filter((d) => d.meta?.status === "cancelled" || d.meta?.status === "discarded");
  const activeKeys = new Set(active.map(key));
  const orphan = voided.filter((d) => salesKeys.has(key(d)) && !activeKeys.has(key(d)) && d.igst + d.cgst + d.sgst + d.cess > 0);
  if (orphan.length) {
    const total = orphan.reduce((s, d) => s + d.igst + d.cgst + d.sgst + d.cess, 0);
    exceptions.push(ex({ module: "G", type: "EWB_CANCELLED_DISCARDED", severity: "medium", classification: "requires_investigation", sourceIds: orphan.map((d) => d.id),
      diff: { ...zeroDiff(), tax: total },
      description: `${orphan.length} e-way bill(s) carrying tax of ${R(total)} stand cancelled/discarded while the invoices remain in the books with no replacement e-way bill; confirm whether the goods moved and how.` }));
  }
  // Sales of goods ≥ ₹50,000 without any e-way bill
  const ewbKeys = new Set(outward.map(key));
  const missing = sales.filter((d) => {
    const hsn = String(d.meta?.hsn ?? "");
    const value = Number(d.meta?.invoiceValue ?? 0) || d.taxable + d.igst + d.cgst + d.sgst + d.cess;
    return !hsn.startsWith("99") && value >= 5_000_000 && !ewbKeys.has(key(d)) && !d.meta?.ewbNo && !isExportish(d);
  });
  for (const d of missing.slice(0, 5000)) exceptions.push(ex({ module: "G", type: "SALE_WITHOUT_EWB", severity: "medium", classification: "documentary_deficiency",
    docNo: d.docNo, docDate: d.docDate, gstin: d.gstin, name: d.name, period: d.period, sourceIds: [d.id],
    description: `Invoice ${d.docNo} for goods (value ${R(Number(d.meta?.invoiceValue ?? 0) || d.taxable)}) has no e-way bill on record; confirm exemption (Rule 138(14)) or produce the e-way bill.` }));
  return { matches, exceptions, summary: { ewbOutward: outward.length, active: active.length, voided: voided.length, taxInCess: inCess.length, salesWithoutEwb: missing.length } };
}

// ===========================================================================================
// 6. Imports and exports
// ===========================================================================================
export function reconImportExport(data: GstinData, ctx: ReconContext): ReconOutput {
  const exceptions: ExceptionDraft[] = [];
  const matches: MatchResult[] = [];
  // Exports: books export invoices / GSTR-1 Table 6A vs shipping bills
  const exportDocs = [...data.sales.filter((d) => isExportish(d) && !/sez|deemed/i.test(String(d.meta?.supplyType ?? ""))),
    ...data.gstr1.filter((d) => /^6A/.test(String(d.meta?.table ?? "")))];
  const byInv = new Map<string, RDoc[]>();
  for (const d of exportDocs) (byInv.get(d.docNoNorm) ?? byInv.set(d.docNoNorm, []).get(d.docNoNorm)!).push(d);
  const sbByInv = new Map<string, typeof data.sb>();
  for (const s of data.sb) if (s.invoiceNorm) (sbByInv.get(s.invoiceNorm) ?? sbByInv.set(s.invoiceNorm, []).get(s.invoiceNorm)!).push(s);

  // GSTR-1 Table 6A rows missing shipping bill particulars
  const g1NoSb = data.gstr1.filter((d) => /^6A/.test(String(d.meta?.table ?? "")) && (!d.meta?.sbNo || !d.meta?.sbDate || !d.meta?.portCode));
  if (g1NoSb.length) {
    const inv = new Set(g1NoSb.map((d) => d.docNoNorm));
    const value = g1NoSb.reduce((s, d) => s + d.taxable, 0);
    exceptions.push(ex({ module: "H", type: "EXPORT_SB_MISSING", severity: "high", classification: "confirmed", sourceIds: g1NoSb.map((d) => d.id),
      diff: { ...zeroDiff(), taxable: value },
      description: `${inv.size} export invoice(s) aggregating ${R(value)} are reported in GSTR-1 Table 6A without shipping bill number, date and/or port code; the data cannot be transmitted to ICEGATE and zero-rating is unsupported on the return (amend through Table 9A within the Section 37(3) window).` }));
  }
  const today = ctx.asOf;
  for (const [inv, docs] of Array.from(byInv.entries()).sort()) {
    const d = docs[0];
    const sbs = sbByInv.get(inv) ?? [];
    const sbFromReturn = docs.find((x) => x.meta?.sbNo)?.meta;
    const agg = aggregate(docs.filter((x) => x.meta?.source === "books").length ? docs.filter((x) => x.meta?.source === "books") : docs);
    if (!sbs.length && !sbFromReturn) {
      if (d.docDate && addMonths(d.docDate, 3) < today) {
        const igst = Math.round(agg.taxable * Number(d.rate ?? 18) / 100);
        exceptions.push(ex({ module: "H", type: "EXPORT_96A_3M", severity: "high", classification: "requires_investigation", docNo: d.docNo, docDate: d.docDate,
          sourceIds: docs.map((x) => x.id), diff: { ...zeroDiff(), taxable: agg.taxable, igst, tax: igst },
          description: `No shipping bill is on record for export invoice ${d.docNo} dated ${d.docDate} and three months have elapsed; unless export within three months is evidenced, IGST of about ${R(igst)} (at ${d.rate ?? 18}%) is payable with interest under Rule 96A(1).` }));
      }
      continue;
    }
    const sb = sbs[0];
    if (sb && d.docDate) {
      const leo = sb.leoDate ?? sb.sbDate;
      if (leo && addMonths(d.docDate, 3) < leo) exceptions.push(ex({ module: "H", type: "EXPORT_96A_3M", severity: "high", classification: "probable", docNo: d.docNo, docDate: d.docDate,
        sourceIds: [...docs.map((x) => x.id), sb.id], diff: { ...zeroDiff(), taxable: agg.taxable },
        description: `Export invoice ${d.docNo} dated ${d.docDate}: let export order ${leo} is more than three months later (Rule 96A(1)).` }));
      if (sb.fob != null && Math.abs(sb.fob - agg.taxable) > Math.max(ctx.materiality / 10, Math.round(agg.taxable * 0.05))) exceptions.push(ex({ module: "H",
        type: "SB_VALUE_MISMATCH", severity: "low", classification: "requires_investigation", docNo: d.docNo, docDate: d.docDate, sourceIds: [...docs.map((x) => x.id), sb.id],
        diff: { ...zeroDiff(), taxable: agg.taxable - sb.fob },
        description: `Export invoice ${d.docNo}: taxable value ${R(agg.taxable)} vs FOB in shipping bill ${sb.sbNo} ${R(sb.fob)}; reconcile (exchange rate, freight/insurance).` }));
    }
  }
  // ICEGATE transmission status, checked on every shipping bill (matched or not)
  for (const sb of data.sb) {
    if (sb.icegateStatus && !/^(SB000|success|transmitted|ok)/i.test(sb.icegateStatus)) exceptions.push(ex({ module: "H", type: "ICEGATE_NOT_TRANSMITTED",
      severity: "high", classification: "confirmed", docNo: sb.invoiceNo, docDate: sb.invoiceDate, sourceIds: [sb.id],
      description: `Shipping bill ${sb.sbNo} dated ${sb.sbDate}${sb.invoiceNo ? ` (invoice ${sb.invoiceNo})` : ""} shows ICEGATE status "${sb.icegateStatus}" — the export is not validated against GSTR-1 and any IGST refund is withheld.` }));
  }
  const sbOrphans = data.sb.filter((s) => !s.invoiceNorm || !byInv.has(s.invoiceNorm));
  for (const s of sbOrphans) exceptions.push(ex({ module: "H", type: "SB_WITHOUT_INVOICE", severity: "medium", classification: "requires_investigation",
    docNo: s.invoiceNo, docDate: s.invoiceDate, sourceIds: [s.id],
    description: `Shipping bill ${s.sbNo} dated ${s.sbDate} refers to invoice ${s.invoiceNo ?? "—"} which is not in the sales register or GSTR-1 export tables.` }));

  // Imports: bills of entry vs purchase register vs GSTR-2B IMPG
  const boeBooks = data.purchases.filter((d) => d.docType === "BOE" || d.meta?.isImport || d.meta?.boeNo);
  const booksByBoe = new Map<string, RDoc[]>();
  for (const d of boeBooks) {
    const k = String(d.meta?.boeNoNorm ?? d.docNoNorm);
    (booksByBoe.get(k) ?? booksByBoe.set(k, []).get(k)!).push(d);
  }
  const impg = new Map(data.gstr2b.filter((d) => /^IMPG/.test(String(d.meta?.table ?? ""))).map((d) => [d.docNoNorm, d]));
  for (const b of data.boe) {
    const books = booksByBoe.get(b.boeNorm) ?? [];
    const claimed = books.reduce((s, d) => s + itcOf(d), 0);
    const nilDuty = b.igst === 0 || /ftwz|warehous|sez|ex.?bond/i.test(b.type ?? "");
    if (nilDuty && claimed > 0) exceptions.push(ex({ module: "J", type: "BOE_ITC_FTWZ", severity: "critical", classification: "confirmed",
      docNo: b.boeNo, docDate: b.boeDate, sourceIds: [b.id, ...books.map((d) => d.id)], diff: { ...zeroDiff(), igst: claimed, tax: claimed },
      description: `IGST credit of ${R(claimed)} has been availed against bill of entry ${b.boeNo} dated ${b.boeDate}${b.type ? ` (${b.type})` : ""} on which IGST paid is ${R(b.igst)}; credit is not available for tax not paid.` }));
    else if (claimed > b.igst + b.cess + ctx.tolerance) exceptions.push(ex({ module: "J", type: "BOE_EXCESS_ITC", severity: "high", classification: "probable",
      docNo: b.boeNo, docDate: b.boeDate, sourceIds: [b.id, ...books.map((d) => d.id)], diff: { ...zeroDiff(), igst: claimed - b.igst - b.cess, tax: claimed - b.igst - b.cess },
      description: `ITC of ${R(claimed)} on bill of entry ${b.boeNo} exceeds IGST and cess paid (${R(b.igst + b.cess)}).` }));
    if (b.igst > 0 && !books.length) exceptions.push(ex({ module: "J", type: "BOE_NOT_IN_BOOKS", severity: "medium", classification: "requires_investigation",
      docNo: b.boeNo, docDate: b.boeDate, sourceIds: [b.id], diff: { ...zeroDiff(), igst: b.igst, tax: b.igst },
      description: `Bill of entry ${b.boeNo} dated ${b.boeDate} (IGST ${R(b.igst)}) is not recorded in the purchase register.` }));
    if (b.igst > 0 && impg.size && !impg.has(b.boeNorm)) exceptions.push(ex({ module: "J", type: "BOE_NOT_IN_2B_IMPG", severity: "medium", classification: "documentary_deficiency",
      docNo: b.boeNo, docDate: b.boeDate, sourceIds: [b.id], diff: zeroDiff(),
      description: `Bill of entry ${b.boeNo} is not reflected in GSTR-2B (IMPG); verify the GSTIN on the bill of entry and the ICEGATE–GSTN reference date.` }));
    if (b.paidUnderProtest) exceptions.push(ex({ module: "J", type: "DUTY_UNDER_PROTEST", severity: "opportunity", classification: "potential_opportunity",
      docNo: b.boeNo, docDate: b.boeDate, sourceIds: [b.id], diff: zeroDiff(),
      description: `Duty on bill of entry ${b.boeNo} was paid under protest; track the classification dispute and the refund limitation under Section 27 of the Customs Act.` }));
  }
  // ITC claimed on BOE documents in books with no bill of entry record
  const boeKnown = new Set(data.boe.map((b) => b.boeNorm));
  if (data.boe.length) for (const [k, docs] of booksByBoe) {
    const claimed = docs.reduce((s, d) => s + itcOf(d), 0);
    if (!boeKnown.has(k) && claimed > 0) exceptions.push(ex({ module: "J", type: "IMPORT_ITC_WITHOUT_BOE", severity: "high", classification: "requires_investigation",
      docNo: docs[0].docNo, docDate: docs[0].docDate, sourceIds: docs.map((d) => d.id), diff: { ...zeroDiff(), igst: claimed, tax: claimed },
      description: `Import ITC of ${R(claimed)} claimed on ${docs[0].docNo} without a matching bill of entry in the ICEGATE data provided (Rule 36(1)(d)).` }));
  }
  return { matches, exceptions, summary: { exportInvoices: byInv.size, shippingBills: data.sb.length, billsOfEntry: data.boe.length } };
}

// ===========================================================================================
// 7. Trial balance / ledgers vs returns
// ===========================================================================================
const SALES_LEDGER = /sales|revenue|income from operations|turnover/i;
const OUTPUT_TAX = /output|gst payable|igst payable|cgst payable|sgst payable/i;
const INPUT_TAX = /input|itc|gst receivable|credit receivable/i;

export function reconTrialBalance(entity: { ledgers: GstinData["ledgers"]; sales: RDoc[]; gstr1: RDoc[]; gstr3b: ReturnLine[] }, ctx: ReconContext): ReconOutput {
  const exceptions: ExceptionDraft[] = [];
  const tb = entity.ledgers.filter((l) => l.source === "trial_balance");
  const salesLedgers = tb.filter((l) => SALES_LEDGER.test(l.name) || SALES_LEDGER.test(l.group ?? ""));
  const tbTurnover = salesLedgers.reduce((s, l) => s + (l.credit - l.debit || -l.closing), 0);
  const books = entity.sales.reduce((s, d) => s + (d.docType === "CRN" ? -1 : 1) * d.taxable, 0);
  const g1 = Array.from(gstr1LiabilityByPeriod(entity.gstr1).values()).reduce((s, h) => s + h.taxable, 0);
  const g3 = entity.gstr3b.filter((l) => /^3\.1\((a|b|c|e)\)$/.test(l.table)).reduce((s, l) => s + l.taxable, 0);
  if (tb.length && salesLedgers.length) {
    const d1 = tbTurnover - books;
    if (Math.abs(d1) > ctx.materiality) exceptions.push(ex({ module: "N", type: "TURNOVER_TB_VS_REGISTER", severity: "medium", classification: "requires_investigation",
      sourceIds: salesLedgers.map((l) => l.id), diff: { ...zeroDiff(), taxable: d1 },
      description: `Turnover per trial balance sales ledgers ${R(tbTurnover)} differs from the sales register ${R(books)} by ${R(d1)} (verify non-GST income, stock transfers and unbilled revenue).` }));
    if (entity.gstr3b.length && Math.abs(tbTurnover - g3) > ctx.materiality) exceptions.push(ex({ module: "N", type: "TURNOVER_TB_VS_3B", severity: "high", classification: "requires_investigation",
      sourceIds: salesLedgers.map((l) => l.id), diff: { ...zeroDiff(), taxable: tbTurnover - g3 },
      description: `Turnover per books ${R(tbTurnover)} vs outward supplies declared in GSTR-3B Tables 3.1(a), (b), (c) and (e) ${R(g3)}; difference ${R(tbTurnover - g3)} to be explained in GSTR-9C.` }));
  }
  for (const l of tb.filter((x) => INPUT_TAX.test(x.name) && /gst|igst|cgst|sgst|itc/i.test(x.name))) {
    if (l.closing < -ctx.tolerance) exceptions.push(ex({ module: "C", type: "NEGATIVE_ITC_BALANCE", severity: "medium", classification: "requires_investigation",
      sourceIds: [l.id], diff: { ...zeroDiff(), tax: -l.closing },
      description: `Input tax ledger "${l.name}" shows a credit (negative) balance of ${R(-l.closing)}; credit may have been reversed in books but not in the return, or utilised in excess.` }));
  }
  const cash = entity.ledgers.filter((l) => l.source === "electronic_cash");
  const latest = new Map<string, LedgerRowLike>();
  for (const l of cash) {
    const k = `${l.taxHead ?? l.name}`;
    const cur = latest.get(k);
    if (!cur || (l.period ?? "") > (cur.period ?? "")) latest.set(k, l);
  }
  const cashTotal = Array.from(latest.values()).reduce((s, l) => s + l.closing, 0);
  if (cashTotal > ctx.materiality) exceptions.push(ex({ module: "M", type: "CASH_LEDGER_IDLE", severity: "opportunity", classification: "potential_opportunity",
    sourceIds: Array.from(latest.values()).map((l) => l.id), diff: { ...zeroDiff(), tax: cashTotal },
    description: `Electronic cash ledger balance of ${R(cashTotal)} is lying unutilised; it can be applied against liabilities, transferred to another registration of the same PAN through Form GST PMT-09, or claimed as a refund.` }));
  void OUTPUT_TAX;
  return { matches: [], exceptions, summary: { tbTurnover, booksTurnover: books, gstr1Taxable: g1, gstr3bTaxable: g3, cashBalance: cashTotal } };
}
type LedgerRowLike = GstinData["ledgers"][number];

export type { Severity, Classification };
