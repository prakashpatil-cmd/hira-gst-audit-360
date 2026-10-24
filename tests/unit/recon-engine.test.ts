import { describe, expect, it } from "vitest";
import { matchDocuments, type RDoc } from "@/lib/recon/match";
import { reconBooksVsGstr1, reconGstr1VsGstr3b, reconPrVs2bVs3b, reconEwayBills, reconImportExport, reconEinvoice, reconTrialBalance } from "@/lib/recon/reconcilers";
import { runSpecialChecks } from "@/lib/recon/checks";
import type { GstinData, ReconContext } from "@/lib/recon/types";
import { toPaise } from "@/lib/gst/money";
import { normaliseDocNo } from "@/lib/gst/documents";
import { makeGstin } from "@/lib/gst/gstin";

const OUR = makeGstin("27", "AABCT1234C");
const CUST = makeGstin("29", "AAACD5678E");
const SUP = makeGstin("27", "AAFCS9999K");
let seq = 0;
function d(p: Partial<RDoc> & { docNo: string; taxable: number }): RDoc {
  const igst = p.igst ?? 0;
  return {
    id: `id-${++seq}`, docType: p.docType ?? "INV", docNo: p.docNo, docNoNorm: normaliseDocNo(p.docNo), docDate: p.docDate ?? "2026-04-10",
    gstin: p.gstin === undefined ? CUST : p.gstin, name: p.name ?? null, period: p.period ?? "2026-04-01", rate: p.rate ?? 18,
    taxable: toPaise(p.taxable), igst: toPaise(igst), cgst: toPaise(p.cgst ?? 0), sgst: toPaise(p.sgst ?? 0), cess: toPaise(p.cess ?? 0),
    meta: p.meta ?? {},
  };
}
const empty = (): GstinData => ({ gstinId: "g1", gstin: OUR, sales: [], salesNotes: [], purchases: [], purchaseNotes: [], gstr1: [], gstr3b: [], gstr2b: [], einv: [], ewb: [], boe: [], sb: [], ledgers: [], importIds: [] });
const ctx: ReconContext = { asOf: "2026-10-24", periodFrom: "2026-03-01", periodTo: "2026-06-30", tolerance: 100, materiality: toPaise(10000), einvoiceFrom: "2023-08-01", aatoCrore: 981 };

describe("matchDocuments", () => {
  it("aggregates rate-wise split lines (one-to-many) and matches exactly", () => {
    const L = [d({ docNo: "INV/001", taxable: 1000, igst: 180 }), d({ docNo: "INV/001", taxable: 500, igst: 25, rate: 5 })];
    const R = [d({ docNo: "INV-1", taxable: 1500, igst: 205 })];
    const res = matchDocuments(L, R, { tolerancePaise: 100, key: (x) => `${x.docType}|${x.docNoNorm}` });
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("matched");
    expect(res[0].left!.ids).toHaveLength(2);
  });
  it("detects duplicates, value and tax mismatches, tolerance and missing documents", () => {
    const L = [d({ docNo: "A1", taxable: 1000, igst: 180 }), d({ docNo: "A1", taxable: 1000, igst: 180 }),
      d({ docNo: "A2", taxable: 1000, igst: 180 }), d({ docNo: "A3", taxable: 1000, igst: 180 }), d({ docNo: "A4", taxable: 1000, igst: 180.5 }), d({ docNo: "A5", taxable: 10, igst: 1.8 })];
    const R = [d({ docNo: "A1", taxable: 1000, igst: 180 }), d({ docNo: "A2", taxable: 900, igst: 162 }), d({ docNo: "A3", taxable: 1000, igst: 120 }),
      d({ docNo: "A4", taxable: 1000, igst: 180 }), d({ docNo: "Z9", taxable: 50, igst: 9 })];
    const res = matchDocuments(L, R, { tolerancePaise: 100, key: (x) => x.docNoNorm });
    const by = Object.fromEntries(res.map((r) => [`${r.key}:${r.status}`, r]));
    expect(by["A1:duplicate_left"]).toBeTruthy();
    expect(by["A1:matched"]).toBeTruthy();
    expect(by["A2:value_mismatch"]).toBeTruthy();
    expect(by["A3:tax_mismatch"].diff.tax).toBe(toPaise(60));
    expect(by["A4:matched_tolerance"]).toBeTruthy();
    expect(by["A5:left_only"]).toBeTruthy();
    expect(by["Z9:right_only"]).toBeTruthy();
  });
  it("finds GSTIN mismatches and fuzzy document-number variants", () => {
    const other = makeGstin("29", "AAACZ1111Q");
    const L = [d({ docNo: "INV/77", taxable: 1000, igst: 180, gstin: CUST, docDate: "2026-04-05" }), d({ docNo: "SER/2627/632", taxable: 23267, igst: 4188.06, docDate: "2026-05-18" })];
    const R = [d({ docNo: "INV/77", taxable: 1000, igst: 180, gstin: other, docDate: "2026-04-05" }), d({ docNo: "S632", taxable: 23267, igst: 4188.06, docDate: "2026-05-19" })];
    const res = matchDocuments(L, R, { tolerancePaise: 100, key: (x) => `${x.gstin}|${x.docNoNorm}`, keyWithoutGstin: (x) => `${x.docDate}|${x.docNoNorm}`, fuzzy: true });
    expect(res.map((r) => r.status).sort()).toEqual(["gstin_mismatch", "matched_fuzzy"]);
  });
  it("is deterministic", () => {
    const L = [d({ docNo: "B2", taxable: 1, igst: 0.18 }), d({ docNo: "B1", taxable: 1, igst: 0.18 })];
    const R = [d({ docNo: "B1", taxable: 1, igst: 0.18 })];
    const a = matchDocuments(L, R, { tolerancePaise: 0, key: (x) => x.docNoNorm }).map((r) => [r.key, r.status]);
    const b = matchDocuments([...L].reverse(), R, { tolerancePaise: 0, key: (x) => x.docNoNorm }).map((r) => [r.key, r.status]);
    expect(a).toEqual(b);
  });
});

describe("Books vs GSTR-1", () => {
  it("flags missing sales, missing books entries, under-reporting and B2CS aggregates", () => {
    const g = empty();
    g.sales = [d({ docNo: "S1", taxable: 100000, igst: 18000 }), d({ docNo: "S2", taxable: 50000, igst: 9000 }), d({ docNo: "S3", taxable: 2000, igst: 360 }),
      d({ docNo: "B2C-1", taxable: 1000, cgst: 90, sgst: 90, gstin: null, meta: { pos: "27" } })];
    g.gstr1 = [d({ docNo: "S1", taxable: 100000, igst: 18000, meta: { table: "4A" } }), d({ docNo: "S3", taxable: 2000, igst: 200, meta: { table: "4A" } }),
      d({ docNo: "X9", taxable: 700, igst: 126, meta: { table: "4A" } }), d({ docNo: "", taxable: 800, cgst: 72, sgst: 72, gstin: null, meta: { table: "7", pos: "27" } })];
    const out = reconBooksVsGstr1(g, ctx);
    const types = out.exceptions.map((e) => e.type).sort();
    expect(types).toEqual(["B2C_UNDER_REPORTED", "MISSING_IN_BOOKS", "MISSING_IN_GSTR1", "UNDER_REPORTED_IN_GSTR1"]);
    expect(out.exceptions.find((e) => e.type === "MISSING_IN_GSTR1")!.diff.tax).toBe(toPaise(9000));
    expect(out.exceptions.every((e) => e.sourceIds.length > 0)).toBe(true);
  });
});

describe("GSTR-1 vs GSTR-3B", () => {
  it("separates short reporting, excess and timing differences", () => {
    const g = empty();
    g.gstr1 = [d({ docNo: "a", taxable: 1000000, igst: 180000, period: "2026-03-01", meta: { table: "4A" } }),
      d({ docNo: "b", taxable: 1000000, igst: 180000, period: "2026-04-01", meta: { table: "4A" } }),
      d({ docNo: "c", taxable: 500000, igst: 90000, period: "2026-05-01", meta: { table: "4A" } }),
      d({ docNo: "e", taxable: 100, igst: 18, period: "2026-06-01", meta: { table: "4A" } })];
    const l = (period: string, table: string, taxable: number, igst: number) => ({ id: `3b-${period}-${table}`, period, table, taxable: toPaise(taxable), igst: toPaise(igst), cgst: 0, sgst: 0, cess: 0 });
    g.gstr3b = [l("2026-03-01", "3.1(a)", 600000, 108000), l("2026-04-01", "3.1(a)", 1400000, 252000), l("2026-05-01", "3.1(a)", 300000, 54000), l("2026-06-01", "3.1(a)", 100000, 18000)];
    const out = reconGstr1VsGstr3b(g, ctx);
    const t = Object.fromEntries(out.exceptions.map((e) => [e.period, e.type]));
    expect(t["2026-03-01"]).toBe("TIMING_DIFFERENCE");
    expect(t["2026-04-01"]).toBe("TIMING_DIFFERENCE");
    expect(t["2026-05-01"]).toBe("LIABILITY_SHORT_IN_3B");
    expect(t["2026-06-01"]).toBe("LIABILITY_EXCESS_IN_3B");
  });
});

describe("Purchase register vs GSTR-2B vs GSTR-3B", () => {
  it("classifies ITC exceptions including opportunities and time bar", () => {
    const g = empty();
    const itc = (tax: number) => ({ itcIgst: toPaise(tax), itcCgst: 0, itcSgst: 0, itcCess: 0, itcTotal: toPaise(tax), claimPeriod: "2026-04-01" });
    g.purchases = [
      d({ docNo: "P1", gstin: SUP, taxable: 10000, igst: 1800, meta: itc(1800) }),                          // matched & claimed
      d({ docNo: "P2", gstin: SUP, taxable: 10000, igst: 1800, meta: itc(1800) }),                          // claimed, not in 2B
      d({ docNo: "P3", gstin: SUP, taxable: 10000, igst: 1800, meta: { ...itc(0), itcTotal: 0 } }),         // matched, unclaimed
      d({ docNo: "P4", gstin: SUP, taxable: 10000, igst: 1800, meta: itc(1800) }), d({ docNo: "P4", gstin: SUP, taxable: 10000, igst: 1800, meta: itc(1800) }), // duplicate ITC
      d({ docNo: "OLD/9", gstin: SUP, taxable: 1000, igst: 180, docDate: "2024-05-10", meta: { ...itc(180), claimPeriod: "2026-04-01" } }), // time-barred
    ];
    g.gstr2b = [d({ docNo: "P1", gstin: SUP, taxable: 10000, igst: 1800, meta: { table: "B2B", itcAvailable: true } }),
      d({ docNo: "P3", gstin: SUP, taxable: 10000, igst: 1800, meta: { table: "B2B", itcAvailable: true } }),
      d({ docNo: "P4", gstin: SUP, taxable: 10000, igst: 1800, meta: { table: "B2B", itcAvailable: true } }),
      d({ docNo: "OLD/9", gstin: SUP, taxable: 1000, igst: 180, docDate: "2024-05-10", meta: { table: "B2B", itcAvailable: true } }),
      d({ docNo: "Q7", gstin: SUP, taxable: 5000, igst: 900, meta: { table: "B2B", itcAvailable: true } }),               // in 2B, not books
      d({ docNo: "CN/1", docType: "CRN", gstin: SUP, taxable: 1000, igst: 180, meta: { table: "CDNR", itcAvailable: true } })]; // supplier CN
    g.gstr3b = [{ id: "3b", period: "2026-04-01", table: "4(A)(5)", taxable: 0, igst: toPaise(9000), cgst: 0, sgst: 0, cess: 0 }];
    const out = reconPrVs2bVs3b(g, ctx);
    const types = out.exceptions.map((e) => e.type);
    expect(types).toContain("CLAIMED_NOT_IN_2B");
    expect(types).toContain("MATCHED_UNCLAIMED");
    expect(types).toContain("DUPLICATE_ITC");
    expect(types).toContain("ITC_TIME_BARRED");
    expect(types).toContain("IN_2B_NOT_IN_BOOKS");
    expect(types).toContain("SUPPLIER_CN_NOT_BOOKED");
    expect(types).toContain("ITC_3B_EXCEEDS_2B");
    expect(out.exceptions.find((e) => e.type === "DUPLICATE_ITC")!.diff.tax).toBe(toPaise(1800));
  });
});

describe("E-way bills, e-invoice, imports and exports", () => {
  it("flags tax in the cess field and discarded e-way bills (Tosoh Obs. 10, 12)", () => {
    const g = empty();
    g.sales = [d({ docNo: "S1", taxable: 100000, igst: 18000, meta: { hsn: "38221990" } }), d({ docNo: "S2", taxable: 100000, igst: 18000, meta: { hsn: "38221990" } })];
    g.ewb = [d({ docNo: "S1", taxable: 100000, cess: 18000, meta: { status: "active" } }), d({ docNo: "S2", taxable: 100000, igst: 18000, meta: { status: "discarded" } })];
    const out = reconEwayBills(g, ctx);
    const types = out.exceptions.map((e) => e.type);
    expect(types).toContain("EWB_TAX_IN_CESS");
    expect(types).toContain("EWB_CANCELLED_DISCARDED");
    expect(types).toContain("EWB_TAX_HEAD_MISMATCH");
  });
  it("flags IRN generated but not reported in GSTR-1 (Tosoh Obs. 11)", () => {
    const g = empty();
    g.einv = [d({ docNo: "E1", taxable: 10157200, igst: 0, meta: { status: "ACT" } })];
    g.gstr1 = [];
    expect(reconEinvoice(g, ctx).exceptions.map((e) => e.type)).toContain("IRN_NOT_IN_GSTR1");
  });
  it("flags NIL-duty FTWZ bill of entry credit, missing shipping bills and Rule 96A (Tosoh Obs. 13, 16)", () => {
    const g = empty();
    g.boe = [{ id: "boe1", boeNo: "8047642", boeNorm: "8047642", boeDate: "2026-03-13", igst: 0, cess: 0, assessable: toPaise(48725055), type: "FTWZ", port: "INNSA1", paidUnderProtest: false, hsn: null }];
    g.purchases = [d({ docNo: "8047642", docType: "BOE", gstin: null, taxable: 48725055, igst: 8770510, meta: { itcIgst: toPaise(8770510), itcTotal: toPaise(8770510), boeNoNorm: "8047642" } })];
    g.gstr1 = [d({ docNo: "T/EXP/1", taxable: 500000, igst: 0, rate: 18, docDate: "2025-12-01", meta: { table: "6A-WOPAY" } })];
    const out = reconImportExport(g, ctx);
    const types = out.exceptions.map((e) => e.type);
    expect(types).toContain("BOE_ITC_FTWZ");
    expect(out.exceptions.find((e) => e.type === "BOE_ITC_FTWZ")!.diff.igst).toBe(toPaise(8770510));
    expect(types).toContain("EXPORT_SB_MISSING");
    expect(types).toContain("EXPORT_96A_3M");
  });
  it("finds idle cash ledger balances and negative ITC ledgers", () => {
    const out = reconTrialBalance({ sales: [], gstr1: [], gstr3b: [], ledgers: [
      { id: "c1", source: "electronic_cash", name: "IGST", group: null, taxHead: "IGST", period: "2026-06-01", opening: 0, debit: 0, credit: 0, closing: toPaise(2475430), extra: {} },
      { id: "t1", source: "trial_balance", name: "Input IGST", group: "Duties & Taxes", taxHead: null, period: null, opening: 0, debit: 0, credit: 0, closing: toPaise(-5000), extra: {} }] }, ctx);
    expect(out.exceptions.map((e) => e.type).sort()).toEqual(["CASH_LEDGER_IDLE", "NEGATIVE_ITC_BALANCE"]);
  });
});

describe("Special checks", () => {
  it("detects RCM on foreign software, blocked key-man insurance credit, credit-note defects and wrong tax head", () => {
    const g = empty();
    g.purchases = [d({ docNo: "SER/2627/1452", gstin: SUP, taxable: 200000, igst: 36000, meta: { itcIgst: toPaise(36000), itcTotal: toPaise(36000), ledger: "Insurance - Key Man Policy" } })];
    g.sales = [d({ docNo: "T/MRN/2526/15208", taxable: 17325, igst: 866.25, rate: 5, docDate: "2026-02-23", meta: { hsn: "38221990", pos: "27" } })];
    g.salesNotes = [d({ docNo: "CRN/2526/135", docType: "CRN", taxable: 40425, igst: 2021.25, docDate: "2026-02-20",
      meta: { originalNo: "T/MRN/2526/15208", originalNoNorm: normaliseDocNo("T/MRN/2526/15208"), originalDate: "2026-02-23", hsn: "3002411" } })];
    const ledgers = [{ id: "gl1", source: "general_ledger", name: "Software Expenses", group: "Indirect Expenses", taxHead: null, period: "2026-05-01",
      opening: 0, debit: toPaise(147256), credit: 0, closing: 0, extra: { voucher_ref: "SER/2627/1498", doc_date: "2026-05-23", currency: "USD", narration: "Annual licence" } }];
    const out = runSpecialChecks(g, ledgers, ctx);
    const by = Object.fromEntries(out.exceptions.map((e) => [e.type, e]));
    expect(by.RCM_IMPORT_OF_SERVICES.diff.igst).toBe(toPaise("26506.08"));
    expect(by.BLOCKED_ITC_17_5.diff.tax).toBe(toPaise(36000));
    expect(by.CN_BEFORE_INVOICE).toBeTruthy();
    expect(by.CN_HSN_DIFFERS).toBeTruthy();
    expect(by.WRONG_TAX_HEAD).toBeTruthy();   // IGST on intra-state (POS 27)
  });
});
