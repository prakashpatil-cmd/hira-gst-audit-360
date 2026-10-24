/**
 * Generic deterministic two-sided document matcher.
 *
 *  1. Each side is grouped by match key; rate-wise split lines of one document aggregate together
 *     (permitted one-to-many matching).
 *  2. Exact duplicates within a side (same key, rate and amounts) are separated out and reported.
 *  3. Groups with equal keys are compared head-by-head against the tolerance.
 *  4. Unmatched groups get a second chance through (a) a GSTIN-mismatch pass — same document
 *     number and date but a different counterparty GSTIN — and (b) a fuzzy pass — same counterparty,
 *     same trailing number, dates within 3 days and identical amounts. Fuzzy matches always require review.
 *
 * Output order is stable (sorted by key) so identical inputs produce identical results.
 */
import { daysBetween } from "@/lib/gst/dates";
import { docNoTail } from "@/lib/gst/documents";
import type { Paise } from "@/lib/gst/money";

export interface RDoc {
  id: string;                       // source_transactions.id (drill-down target)
  docType: string;                  // INV, CRN, DBN, BOE ...
  docNo: string;
  docNoNorm: string;
  docDate: string | null;
  gstin: string | null;             // counterparty GSTIN
  name?: string | null;
  period: string | null;
  rate: number | null;
  taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise;
  meta?: Record<string, unknown>;
}

export interface Agg {
  ids: string[];
  docType: string; docNo: string; docNoNorm: string; docDate: string | null; gstin: string | null; name: string | null;
  periods: string[]; rates: number[];
  taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise; tax: Paise;
  docs: RDoc[];
}

export type MatchStatus =
  | "matched" | "matched_tolerance" | "matched_fuzzy" | "value_mismatch" | "tax_mismatch" | "gstin_mismatch"
  | "left_only" | "right_only" | "duplicate_left" | "duplicate_right";

export interface MatchResult {
  key: string;
  status: MatchStatus;
  method: "exact" | "normalised" | "fuzzy" | "gstin" | "none";
  left: Agg | null;
  right: Agg | null;
  diff: { taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise; tax: Paise };
  flags: string[];                  // PERIOD_MISMATCH, HEAD_MISMATCH, GSTIN_DIFFERS, RATE_DIFFERS
}

export interface MatchOptions {
  tolerancePaise: Paise;
  key: (d: RDoc) => string;
  /** If set, a GSTIN-mismatch pass is attempted with this key (should exclude GSTIN). */
  keyWithoutGstin?: (d: RDoc) => string;
  fuzzy?: boolean;
  fuzzyDays?: number;
}

const tax = (a: { igst: Paise; cgst: Paise; sgst: Paise; cess: Paise }) => a.igst + a.cgst + a.sgst + a.cess;

export function aggregate(docs: RDoc[]): Agg {
  const d0 = docs[0];
  const a: Agg = {
    ids: [], docType: d0.docType, docNo: d0.docNo, docNoNorm: d0.docNoNorm, docDate: d0.docDate, gstin: d0.gstin, name: d0.name ?? null,
    periods: [], rates: [], taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0, docs,
  };
  for (const d of docs) {
    a.ids.push(d.id);
    a.taxable += d.taxable; a.igst += d.igst; a.cgst += d.cgst; a.sgst += d.sgst; a.cess += d.cess;
    if (d.period && !a.periods.includes(d.period)) a.periods.push(d.period);
    if (d.rate != null && !a.rates.includes(d.rate)) a.rates.push(d.rate);
    if (!a.gstin && d.gstin) a.gstin = d.gstin;
    if (!a.docDate && d.docDate) a.docDate = d.docDate;
  }
  a.tax = tax(a);
  a.periods.sort(); a.rates.sort((x, y) => x - y);
  return a;
}

const lineSig = (d: RDoc) => [d.rate ?? "", d.taxable, d.igst, d.cgst, d.sgst, d.cess].join("|");

/** Splits a key group into the unique lines and the exact repeats. */
function splitDuplicates(docs: RDoc[]): { unique: RDoc[]; dups: RDoc[] } {
  const seen = new Set<string>();
  const unique: RDoc[] = [], dups: RDoc[] = [];
  for (const d of [...docs].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const s = lineSig(d);
    if (seen.has(s)) dups.push(d); else { seen.add(s); unique.push(d); }
  }
  return { unique, dups };
}

function group(docs: RDoc[], key: (d: RDoc) => string) {
  const m = new Map<string, RDoc[]>();
  for (const d of docs) {
    const k = key(d);
    const arr = m.get(k);
    if (arr) arr.push(d); else m.set(k, [d]);
  }
  return m;
}

const ZERO = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0 };

export function diffOf(l: Agg | null, r: Agg | null) {
  const L = l ?? ZERO, R = r ?? ZERO;
  return { taxable: L.taxable - R.taxable, igst: L.igst - R.igst, cgst: L.cgst - R.cgst, sgst: L.sgst - R.sgst, cess: L.cess - R.cess, tax: L.tax - R.tax };
}

function compare(key: string, l: Agg, r: Agg, tol: Paise, method: MatchResult["method"]): MatchResult {
  const diff = diffOf(l, r);
  const flags: string[] = [];
  const heads = [diff.igst, diff.cgst, diff.sgst, diff.cess];
  const taxOk = heads.every((h) => Math.abs(h) <= tol);
  const totalTaxOk = Math.abs(diff.tax) <= tol;
  const taxableOk = Math.abs(diff.taxable) <= tol;
  if (!taxOk && totalTaxOk) flags.push("HEAD_MISMATCH");
  if (l.gstin && r.gstin && l.gstin !== r.gstin) flags.push("GSTIN_DIFFERS");
  if (l.periods.length && r.periods.length && l.periods.join() !== r.periods.join()) flags.push("PERIOD_MISMATCH");
  if (l.rates.length && r.rates.length && l.rates.join() !== r.rates.join()) flags.push("RATE_DIFFERS");
  let status: MatchStatus;
  if (taxableOk && taxOk) {
    const exact = diff.taxable === 0 && heads.every((h) => h === 0);
    status = method === "fuzzy" ? "matched_fuzzy" : exact ? "matched" : "matched_tolerance";
  } else if (taxableOk) status = "tax_mismatch";
  else status = "value_mismatch";
  if (flags.includes("GSTIN_DIFFERS") && (status === "matched" || status === "matched_tolerance")) status = "gstin_mismatch";
  return { key, status, method, left: l, right: r, diff, flags };
}

export function matchDocuments(left: RDoc[], right: RDoc[], opts: MatchOptions): MatchResult[] {
  const out: MatchResult[] = [];
  const L = group(left, opts.key), R = group(right, opts.key);
  const leftAgg = new Map<string, Agg>(), rightAgg = new Map<string, Agg>();

  for (const [side, groups, aggs, dupStatus] of [["L", L, leftAgg, "duplicate_left"], ["R", R, rightAgg, "duplicate_right"]] as const) {
    for (const [k, docs] of groups) {
      const { unique, dups } = splitDuplicates(docs);
      aggs.set(k, aggregate(unique));
      if (dups.length) {
        const a = aggregate(dups);
        out.push({ key: k, status: dupStatus, method: "exact", left: side === "L" ? a : null, right: side === "R" ? a : null,
          diff: side === "L" ? diffOf(a, null) : diffOf(null, a), flags: [] });
      }
    }
  }

  const keys = Array.from(new Set([...leftAgg.keys(), ...rightAgg.keys()])).sort();
  const leftOnly: [string, Agg][] = [], rightOnly: [string, Agg][] = [];
  for (const k of keys) {
    const l = leftAgg.get(k), r = rightAgg.get(k);
    if (l && r) out.push(compare(k, l, r, opts.tolerancePaise, "normalised"));
    else if (l) leftOnly.push([k, l]);
    else if (r) rightOnly.push([k, r]);
  }

  // Pass 2: same document, different counterparty GSTIN.
  const usedR = new Set<string>();
  const usedL = new Set<string>();
  if (opts.keyWithoutGstin) {
    const rIndex = new Map<string, [string, Agg][]>();
    for (const e of rightOnly) {
      const k2 = opts.keyWithoutGstin(e[1].docs[0]);
      (rIndex.get(k2) ?? rIndex.set(k2, []).get(k2)!).push(e);
    }
    for (const [k, l] of leftOnly) {
      const cands = (rIndex.get(opts.keyWithoutGstin(l.docs[0])) ?? []).filter(([rk]) => !usedR.has(rk));
      if (cands.length === 1) {
        const [rk, r] = cands[0];
        usedR.add(rk); usedL.add(k);
        const res = compare(`${k}~${rk}`, l, r, opts.tolerancePaise, "gstin");
        res.status = "gstin_mismatch";
        if (!res.flags.includes("GSTIN_DIFFERS")) res.flags.push("GSTIN_DIFFERS");
        out.push(res);
      }
    }
  }

  // Pass 3: fuzzy — same counterparty and trailing number, dates within N days, amounts within tolerance.
  if (opts.fuzzy) {
    const days = opts.fuzzyDays ?? 3;
    const rIndex = new Map<string, [string, Agg][]>();
    for (const e of rightOnly) {
      if (usedR.has(e[0])) continue;
      const fk = `${e[1].gstin ?? ""}|${e[1].docType}|${docNoTail(e[1].docNo)}`;
      (rIndex.get(fk) ?? rIndex.set(fk, []).get(fk)!).push(e);
    }
    for (const [k, l] of leftOnly) {
      if (usedL.has(k)) continue;
      const fk = `${l.gstin ?? ""}|${l.docType}|${docNoTail(l.docNo)}`;
      if (!docNoTail(l.docNo)) continue;
      const cands = (rIndex.get(fk) ?? []).filter(([rk, r]) => !usedR.has(rk)
        && (!l.docDate || !r.docDate || Math.abs(daysBetween(l.docDate, r.docDate)) <= days)
        && Math.abs(l.taxable - r.taxable) <= opts.tolerancePaise && Math.abs(l.tax - r.tax) <= opts.tolerancePaise);
      if (cands.length === 1) {
        const [rk, r] = cands[0];
        usedR.add(rk); usedL.add(k);
        out.push(compare(`${k}~${rk}`, l, r, opts.tolerancePaise, "fuzzy"));
      }
    }
  }

  for (const [k, l] of leftOnly) if (!usedL.has(k)) out.push({ key: k, status: "left_only", method: "none", left: l, right: null, diff: diffOf(l, null), flags: [] });
  for (const [k, r] of rightOnly) if (!usedR.has(k)) out.push({ key: k, status: "right_only", method: "none", left: null, right: r, diff: diffOf(null, r), flags: [] });
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.status < b.status ? -1 : 1));
}

export function summarise(results: MatchResult[]) {
  const counts: Record<string, number> = {};
  const values: Record<string, { taxable: Paise; tax: Paise }> = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const v = (values[r.status] ??= { taxable: 0, tax: 0 });
    v.taxable += Math.abs(r.diff.taxable) || (r.left?.taxable ?? r.right?.taxable ?? 0);
    v.tax += Math.abs(r.diff.tax) || (r.left?.tax ?? r.right?.tax ?? 0);
  }
  return { counts, values };
}
