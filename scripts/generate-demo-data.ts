/**
 * Generates deterministic synthetic import files for a three-GSTIN manufacturer with deliberately
 * planted mismatches (the "answer key" is written to samples/demo/EXPECTED.md).
 *
 *   npm run demo:data            → writes samples/demo/*
 *
 * No real taxpayer data is used: every GSTIN is synthetic (checksum-valid, fictitious PANs).
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { makeGstin } from "@/lib/gst/gstin";

const OUT = path.resolve("samples/demo");
fs.mkdirSync(OUT, { recursive: true });

// --- deterministic PRNG -------------------------------------------------------------------
let seed = 20261024;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map((c) => c == null ? "" : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c)).join(",")).join("\n") + "\n";

export const CLIENT = { name: "Helix Diagnostics Manufacturing Private Limited", pan: "AABCH2468K" };
export const OUR = { MH: makeGstin("27", CLIENT.pan), KA: makeGstin("29", CLIENT.pan), WB: makeGstin("19", CLIENT.pan) };
const customers = [
  { name: "Delta Path Labs Ltd", gstin: makeGstin("07", "AAACD1111L"), state: "07" },
  { name: "Medicore Hospitals Pvt Ltd", gstin: makeGstin("27", "AAACM2222M"), state: "27" },
  { name: "Southern Clinical Services LLP", gstin: makeGstin("33", "AAJFS3333N"), state: "33" },
  { name: "Unity Diagnostics Pvt Ltd", gstin: makeGstin("24", "AAACU4444P"), state: "24" },
  { name: "Pune Reference Lab Pvt Ltd", gstin: makeGstin("27", "AAACP5555Q"), state: "27" },
];
const suppliers = [
  { name: "Reagent Chem Industries", gstin: makeGstin("27", "AAFCR6666R"), ledger: "Purchase of Raw Materials" },
  { name: "Precision Packaging Co", gstin: makeGstin("27", "AABFP7777S"), ledger: "Packing Material" },
  { name: "Swift Logistics Pvt Ltd", gstin: makeGstin("27", "AAECS8888T"), ledger: "Freight Outward" },
  { name: "TechCare Services", gstin: makeGstin("29", "AAFFT9999U"), ledger: "Repairs and Maintenance" },
  { name: "Lifeline Insurance Co Ltd", gstin: makeGstin("27", "AAACL1212V"), ledger: "Insurance - Key Man Policy" },
];
const months = ["2026-04", "2026-05", "2026-06"];

// --- Sales (Maharashtra registration) -------------------------------------------------------
interface Sale { no: string; date: string; cust: typeof customers[number]; hsn: string; rate: number; taxable: number; igst: number; cgst: number; sgst: number; supply: string; type: string }
const sales: Sale[] = [];
let n = 1;
for (const m of months) {
  for (let i = 0; i < 14; i++) {
    const cust = pick(customers);
    const rate = pick([12, 18, 18, 5]);
    const taxable = round2(40000 + rnd() * 460000);
    const inter = cust.state !== "27";
    const tax = round2(taxable * rate / 100);
    const day = String(1 + Math.floor(rnd() * 27)).padStart(2, "0");
    sales.push({ no: `HDM/2627/${String(n++).padStart(4, "0")}`, date: `${m}-${day}`, cust, hsn: rate === 5 ? "38221990" : rate === 12 ? "30021500" : "90278990",
      rate, taxable, igst: inter ? tax : 0, cgst: inter ? 0 : round2(tax / 2), sgst: inter ? 0 : round2(tax / 2), supply: "B2B", type: "Sales" });
  }
}
// Exports under LUT (zero-rated)
const exportsList: Sale[] = [];
for (let i = 0; i < 5; i++) exportsList.push({ no: `HDM/EXP/2627/${i + 1}`, date: `2026-0${4 + Math.floor(i / 2)}-1${i}`, cust: { name: "Global Diagnostics FZE", gstin: "", state: "96" },
  hsn: "90278990", rate: 18, taxable: round2(600000 + i * 125000), igst: 0, cgst: 0, sgst: 0, supply: "Export without payment (LUT)", type: "Sales" });

// Planted sales defects
const missingInG1 = [sales[3].no, sales[20].no];                // MISSING_IN_GSTR1
const taxMismatch = sales[10].no;                                // UNDER_REPORTED_IN_GSTR1
const gstinWrong = sales[15].no;                                 // GSTIN_MISMATCH
const duplicateRow = sales[30];                                  // DUPLICATE row in sales register
const notInBooks = "HDM/2627/9001";                              // MISSING_IN_BOOKS
const irnNotInG1 = sales[25].no;                                 // IRN generated, not in GSTR-1 (also in missingInG1 logic below)
const cessEwb = [sales[5].no, sales[6].no, sales[7].no];         // EWB tax in cess field
const discardedEwb = [sales[8].no, sales[9].no];                 // discarded EWBs, invoices still in books

// --- write sales register (xlsx, Tally-like headers) ---------------------------------------
async function writeSales() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Register");
  ws.addRow(["Helix Diagnostics Manufacturing Private Limited — Sales Register 01-Apr-2026 to 30-Jun-2026"]);
  ws.addRow([]);
  ws.addRow(["Date", "Particulars", "Voucher Type", "Voucher No.", "GSTIN/UIN", "Place of Supply", "HSN/SAC", "GST Rate", "Taxable Value", "IGST", "CGST", "SGST", "Invoice Value", "Supply Type"]);
  const rows = [...sales, duplicateRow, ...exportsList];
  for (const s of rows) ws.addRow([new Date(s.date + "T00:00:00Z"), s.cust.name, s.type, s.no, s.cust.gstin || null, s.cust.state === "96" ? "96-Foreign Country" : s.cust.state, s.hsn, `${s.rate}%`,
    s.taxable, s.igst, s.cgst, s.sgst, round2(s.taxable + s.igst + s.cgst + s.sgst), s.supply]);
  // A credit note dated before the invoice it adjusts (CN_BEFORE_INVOICE) with a different HSN
  const orig = sales[12];
  ws.addRow([new Date(addDays(orig.date, -3) + "T00:00:00Z"), orig.cust.name, "Credit Note", "HDM/CN/2627/01", orig.cust.gstin, orig.cust.state, "30024110", `${orig.rate}%`,
    -5000, orig.igst ? -round2(5000 * orig.rate / 100) : 0, orig.cgst ? -round2(2500 * orig.rate / 100) : 0, orig.sgst ? -round2(2500 * orig.rate / 100) : 0, null, "B2B"]);
  ws.getRow(ws.rowCount).getCell(15).value = orig.no;
  ws.getRow(3).getCell(15).value = "Original Invoice No";
  await wb.xlsx.writeFile(path.join(OUT, "01_sales_register_MH.xlsx"));
  return orig;
}
function addDays(iso: string, d: number) { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }

// --- GSTR-1 (portal Excel style, CSV) -------------------------------------------------------
function writeGstr1(cn: Sale) {
  const rows: (string | number | null)[][] = [["Section", "GSTIN/UIN of Recipient", "Invoice Number", "Invoice date", "Place Of Supply", "Rate", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Return Period", "Shipping Bill Number", "Shipping Bill Date", "Port Code"]];
  for (const s of sales) {
    if (missingInG1.includes(s.no) || s.no === irnNotInG1) continue;
    const period = s.date.slice(5, 7) + s.date.slice(0, 4);
    let igst = s.igst, cgst = s.cgst, sgst = s.sgst, gstin = s.cust.gstin;
    if (s.no === taxMismatch) { igst = round2(igst * 0.5); cgst = round2(cgst * 0.5); sgst = round2(sgst * 0.5); }
    if (s.no === gstinWrong) gstin = makeGstin(s.cust.state, "AAACZ9876Z");
    rows.push(["B2B", gstin, s.no, dmy(s.date).replace(/\//g, "-"), s.cust.state, s.rate, s.taxable, igst, cgst, sgst, period, null, null, null]);
  }
  rows.push(["B2B", customers[0].gstin, notInBooks, "28-06-2026", "07", 18, 75000, 13500, 0, 0, "062026", null, null, null]);
  exportsList.forEach((e, i) => rows.push(["EXPWOP", null, e.no, dmy(e.date).replace(/\//g, "-"), "96", 18, e.taxable, 0, 0, 0, e.date.slice(5, 7) + e.date.slice(0, 4),
    i < 2 ? `70${4512 + i}` : null, i < 2 ? dmy(addDays(e.date, 4)).replace(/\//g, "-") : null, i < 2 ? "INNSA1" : null]));
  rows.push(["CDNR", cn.cust.gstin, "HDM/CN/2627/01", dmy(addDays(cn.date, -3)).replace(/\//g, "-"), cn.cust.state, cn.rate, 5000, cn.igst ? round2(5000 * cn.rate / 100) : 0,
    cn.cgst ? round2(2500 * cn.rate / 100) : 0, cn.sgst ? round2(2500 * cn.rate / 100) : 0, cn.date.slice(5, 7) + cn.date.slice(0, 4), null, null, null]);
  fs.writeFileSync(path.join(OUT, "02_gstr1_MH.csv"), csv(rows));
  return rows.slice(1);
}

// --- GSTR-3B (table-wise) -------------------------------------------------------------------
function writeGstr3b(g1: (string | number | null)[][]) {
  const rows: (string | number | null)[][] = [["Return Period", "Table", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"]];
  for (const m of months) {
    const period = m.slice(5, 7) + m.slice(0, 4);
    const lines = g1.filter((r) => r[10] === period);
    const sign = (r: (string | number | null)[]) => (r[0] === "CDNR" ? -1 : 1);
    const sum = (i: number) => round2(lines.filter((r) => r[0] !== "EXPWOP").reduce((s, r) => s + sign(r) * Number(r[i] ?? 0), 0));
    let taxable = sum(6), igst = sum(7), cgst = sum(8), sgst = sum(9);
    if (m === "2026-05") { igst = round2(igst - 42000); }                  // short-declared in May (LIABILITY_SHORT_IN_3B)
    if (m === "2026-04") { cgst = round2(cgst - 15000); sgst = round2(sgst - 15000); }  // April short …
    if (m === "2026-06") { cgst = round2(cgst + 15000); sgst = round2(sgst + 15000); }  // … caught up in June: TIMING_DIFFERENCE (non-adjacent pair is beyond 2 months? Apr→Jun is within 2)
    rows.push([period, "3.1(a) Outward taxable supplies", taxable, igst, cgst, sgst, 0]);
    const exp = g1.filter((r) => r[10] === period && r[0] === "EXPWOP").reduce((s, r) => s + Number(r[6]), 0);
    rows.push([period, "3.1(b) Zero rated supplies", round2(exp), 0, 0, 0, 0]);
    const itc = purchases.filter((p) => p.claim === m && !p.rcm).reduce((s, p) => s + p.itc, 0);
    rows.push([period, "4(A)(5) All other ITC", 0, round2(itc * 0.6), round2(itc * 0.2), round2(itc * 0.2), 0]);
    void taxable;
  }
  fs.writeFileSync(path.join(OUT, "03_gstr3b_MH.csv"), csv(rows));
}

// --- Purchases and GSTR-2B ----------------------------------------------------------------
interface Purchase { no: string; date: string; sup: { name: string; gstin: string; ledger: string }; taxable: number; igst: number; cgst: number; sgst: number; itc: number; claim: string; rcm: boolean; inTwoB: boolean; boe?: string; type: string }
const purchases: Purchase[] = [];
let pn = 1;
for (const m of months) for (let i = 0; i < 10; i++) {
  const sup = suppliers[i % 4];
  const taxable = round2(20000 + rnd() * 180000);
  const intra = sup.gstin.startsWith("27");
  const tax = round2(taxable * 0.18);
  const day = String(1 + Math.floor(rnd() * 27)).padStart(2, "0");
  purchases.push({ no: `${sup.name.split(" ")[0].toUpperCase()}/${pn++}`, date: `${m}-${day}`, sup, taxable, igst: intra ? 0 : tax, cgst: intra ? round2(tax / 2) : 0, sgst: intra ? round2(tax / 2) : 0,
    itc: tax, claim: m, rcm: false, inTwoB: true, type: "Purchase" });
}
purchases[2].inTwoB = false; purchases[13].inTwoB = false; purchases[25].inTwoB = false;            // CLAIMED_NOT_IN_2B ×3
purchases.push({ ...purchases[17] });                                                               // DUPLICATE_ITC
purchases.push({ no: "LIFE/KM/552", date: "2026-06-30", sup: suppliers[4], taxable: 200000, igst: 0, cgst: 18000, sgst: 18000, itc: 36000, claim: "2026-06", rcm: false, inTwoB: true, type: "Purchase" }); // BLOCKED key-man
purchases.push({ no: "REAGENT/OLD/77", date: "2024-05-10", sup: suppliers[0], taxable: 10000, igst: 0, cgst: 900, sgst: 900, itc: 1800, claim: "2026-04", rcm: false, inTwoB: true, type: "Purchase" }); // time-barred
purchases.push({ no: "FTWZ-INV-8047642", date: "2026-04-13", sup: { name: "Overseas Principal (FTWZ)", gstin: "", ledger: "Import of Goods" }, taxable: 4872505, igst: 877051, cgst: 0, sgst: 0, itc: 877051,
  claim: "2026-04", rcm: false, inTwoB: false, boe: "8047642", type: "Import" });                       // BOE_ITC_FTWZ (nil-duty BOE)
const twoBOnly = [
  { no: "SWIFT/9911", date: "2026-05-14", sup: suppliers[2], taxable: 50000, igst: 0, cgst: 4500, sgst: 4500 },
  { no: "TECH/7781", date: "2026-06-09", sup: suppliers[3], taxable: 30000, igst: 5400, cgst: 0, sgst: 0 },
];

function writePurchases() {
  const rows: (string | number | null)[][] = [["Voucher Type", "Supplier Invoice No", "Supplier Invoice Date", "Supplier GSTIN", "Supplier Name", "Taxable Value", "IGST", "CGST", "SGST",
    "ITC IGST", "ITC CGST", "ITC SGST", "ITC Claim Period", "Expense Ledger", "Reverse Charge", "Import", "BOE No"]];
  for (const p of purchases) {
    const share = p.itc / Math.max(0.01, p.igst + p.cgst + p.sgst);
    rows.push([p.type === "Import" ? "Import" : "Purchase", p.no, dmy(p.date), p.sup.gstin || null, p.sup.name, p.taxable, p.igst, p.cgst, p.sgst,
      round2(p.igst * share), round2(p.cgst * share), round2(p.sgst * share), `${p.claim.slice(5)}${p.claim.slice(0, 4)}`, p.sup.ledger, p.rcm ? "Y" : "N", p.boe ? "Y" : "N", p.boe ?? null]);
  }
  fs.writeFileSync(path.join(OUT, "04_purchase_register_MH.csv"), csv(rows));
}

function writeGstr2b() {
  // Portal JSON layout (data.docdata.b2b[].inv[].items[] / impg[]), one file per month.
  for (const m of months) {
    const period = m.slice(5, 7) + m.slice(0, 4);
    const inMonth = purchases.filter((p) => p.claim === m && p.inTwoB && !p.boe && p.date >= "2026-01-01");
    const dup = new Set<string>();
    const bySup = new Map<string, { ctin: string; trdnm: string; supfildt: string; supprd: string; inv: object[] }>();
    const addInv = (p: { no: string; date: string; sup: { name: string; gstin: string }; taxable: number; igst: number; cgst: number; sgst: number }) => {
      if (dup.has(p.no)) return; dup.add(p.no);
      const b = bySup.get(p.sup.gstin) ?? { ctin: p.sup.gstin, trdnm: p.sup.name, supfildt: `11-${String(+m.slice(5) + 1).padStart(2, "0")}-2026`, supprd: period, inv: [] };
      b.inv.push({ inum: p.no, typ: "R", dt: dmy(p.date).replace(/\//g, "-"), val: round2(p.taxable + p.igst + p.cgst + p.sgst), pos: "27", rev: "N", itcavl: "Y", rsn: "", diffprcnt: 1, srctyp: "e-Invoice",
        items: [{ num: 1, rt: 18, txval: p.taxable, igst: p.igst, cgst: p.cgst, sgst: p.sgst, cess: 0 }] });
      bySup.set(p.sup.gstin, b);
    };
    inMonth.forEach(addInv);
    if (m === "2026-04") addInv(purchases.find((p) => p.no === "REAGENT/OLD/77")!);
    twoBOnly.filter((t) => t.date.startsWith(m)).forEach(addInv);
    const json = { chksum: "demo", data: { gstin: OUR.MH, rtnprd: period, version: "1.0", gendt: `14-${String(+m.slice(5) + 1).padStart(2, "0")}-2026`,
      docdata: { b2b: Array.from(bySup.values()), impg: [] as object[] } } };
    fs.writeFileSync(path.join(OUT, `05_gstr2b_MH_${period}.json`), JSON.stringify(json, null, 1));
  }
}

function writeEwayEinvoice() {
  const ew: (string | number | null)[][] = [["EWB No", "EWB Date", "Status", "Supply Type", "Sub Supply Type", "Doc No", "Doc Date", "From GSTIN", "To GSTIN", "HSN Code", "Taxable Value", "IGST", "CGST", "SGST", "Cess", "Total Value"]];
  let e = 341000100001;
  for (const s of sales) {
    if (s.taxable + s.igst + s.cgst + s.sgst < 50000) continue;
    const inCess = cessEwb.includes(s.no);
    const tax = s.igst + s.cgst + s.sgst;
    ew.push([e++, dmy(s.date), discardedEwb.includes(s.no) ? "Discarded" : "Active", "Outward", "Supply", s.no, dmy(s.date), OUR.MH, s.cust.gstin, s.hsn, s.taxable,
      inCess ? 0 : s.igst, inCess ? 0 : s.cgst, inCess ? 0 : s.sgst, inCess ? tax : 0, round2(s.taxable + tax)]);
  }
  ew.push([e++, "21/06/2026", "Active", "Outward", "Supply", "HDM/2627/8888", "21/06/2026", OUR.MH, customers[1].gstin, "90278990", 90000, 0, 8100, 8100, 0, 106200]); // EWB without sale
  ew.push([e++, "18/05/2026", "Active", "Outward", "Job Work", "HDM/JW/2627/04", "18/05/2026", OUR.MH, makeGstin("27", "AAKFJ3434J"), "38221990", 250000, 0, 0, 0, 0, 250000]); // job work movement
  fs.writeFileSync(path.join(OUT, "06_eway_bills_MH.csv"), csv(ew));

  const ei: (string | number | null)[][] = [["IRN", "Ack No", "Ack Date", "IRN Status", "Doc Type", "Doc No", "Doc Date", "Buyer GSTIN", "Taxable Value", "IGST", "CGST", "SGST"]];
  for (const s of sales) ei.push([`${"a".repeat(20)}${s.no.replace(/\D/g, "").padStart(44, "0")}`, `1121${s.no.replace(/\D/g, "")}`, `${dmy(s.date)} 11:30`, "ACT", "INV", s.no, dmy(s.date), s.cust.gstin, s.taxable, s.igst, s.cgst, s.sgst]);
  fs.writeFileSync(path.join(OUT, "07_einvoice_register_MH.csv"), csv(ei));
}

function writeCustomsAndLedgers() {
  fs.writeFileSync(path.join(OUT, "08_shipping_bills_MH.csv"), csv([["Shipping Bill No", "Shipping Bill Date", "Port Code", "Invoice No", "Invoice Date", "FOB Value INR", "LEO Date", "EGM No", "ICEGATE Status", "BRC No"],
    ...exportsList.slice(0, 2).map((x, i) => [`70${4512 + i}`, dmy(addDays(x.date, 4)), "INNSA1", x.no, dmy(x.date), x.taxable, dmy(addDays(x.date, 5)), `EGM${881 + i}`, "SB000", `BRC/${i + 1}`]),
    [7047799, dmy("2026-06-25"), "INNSA1", "HDM/EXP/2627/99", dmy("2026-06-20"), 410000, dmy("2026-06-26"), "EGM999", "SB005 — invoice mismatch", null]]));
  fs.writeFileSync(path.join(OUT, "09_bills_of_entry_MH.csv"), csv([["BE No", "BE Date", "Port Code", "BE Type", "Supplier Name", "HSN", "Assessable Value", "BCD", "IGST", "Under Protest"],
    ["8047642", "13/04/2026", "INNSA1", "FTWZ (Warehouse)", "Overseas Principal (FTWZ)", "90278990", 4872505, 0, 0, "N"],
    ["8159669", "22/05/2026", "INNSA1", "Home consumption", "Tosei Instruments KK", "38221990", 830000, 83000, 164340, "Y"]]));
  fs.writeFileSync(path.join(OUT, "10_general_ledger.csv"), csv([["Date", "Voucher No", "Ledger", "Group", "Party", "Debit", "Credit", "Narration", "Currency", "Country"],
    ["18/05/2026", "SER/2627/632", "Software Expenses", "Indirect Expenses", "CloudLab Inc", 23267, 0, "Annual LIMS subscription USD 279", "USD", "United States"],
    ["23/05/2026", "SER/2627/1498", "Software Expenses", "Indirect Expenses", "DataSuite Ltd", 147256, 0, "Analytics licence renewal USD 1765", "USD", "United Kingdom"],
    ["11/06/2026", "BP/2627/358", "Insurance Expenses", "Indirect Expenses", "Helix Holdings KK", 11562, 0, "Directors insurance reimbursed to parent company Japan", "JPY", "Japan"],
    ["15/06/2026", "JV/2627/221", "Legal Fees", "Indirect Expenses", "Adv. R. Mehta", 45000, 0, "Legal fees for GST appeal", "INR", "India"],
    ["20/06/2026", "JV/2627/240", "Office Rent", "Indirect Expenses", "Rakesh Patil", 60000, 0, "Office rent June — landlord unregistered", "INR", "India"]]));
  fs.writeFileSync(path.join(OUT, "11_trial_balance.csv"), csv([["Particulars", "Group", "Opening", "Debit", "Credit", "Closing"],
    ["Sales — Domestic", "Sales Accounts", 0, 0, round2(sales.reduce((s, x) => s + x.taxable, 0) + 120000), -round2(sales.reduce((s, x) => s + x.taxable, 0) + 120000)],
    ["Sales — Export", "Sales Accounts", 0, 0, round2(exportsList.reduce((s, x) => s + x.taxable, 0)), -round2(exportsList.reduce((s, x) => s + x.taxable, 0))],
    ["Input IGST", "Duties & Taxes", 0, 400000, 412500, -12500], ["Input CGST", "Duties & Taxes", 0, 260000, 210000, 50000],
    ["Output IGST", "Duties & Taxes", 0, 0, 900000, -900000]]));
  fs.writeFileSync(path.join(OUT, "12_electronic_cash_ledger_WB.csv"), csv([["As at", "Tax Head", "Minor Head", "Balance"], ["06-2026", "IGST", "Tax", 1475430], ["06-2026", "CGST", "Tax", 500000], ["06-2026", "SGST", "Tax", 500000]]));
  fs.writeFileSync(path.join(OUT, "13_fixed_asset_register.csv"), csv([["Asset Code", "Asset Description", "Asset Class", "Capitalisation Date", "Cost", "ITC Availed", "Disposal Date", "Sale Value", "Net Block", "Disposal Type"],
    ["FA-0723", "HLC-723 G8 analyser", "Plant & Machinery", "15/08/2023", 3200000, 576000, "12/06/2026", 2100000, 0, "Sale"],
    ["FA-0815", "Sample loader", "Plant & Machinery", "01/02/2024", 450000, 81000, "", "", 360000, ""]]));
}

const cn = await writeSales();
const g1 = writeGstr1(cn);
writePurchases();
writeGstr3b(g1);
writeGstr2b();
writeEwayEinvoice();
writeCustomsAndLedgers();
fs.writeFileSync(path.join(OUT, "EXPECTED.md"), `# Demo data — planted exceptions (answer key)

Client: ${CLIENT.name} (PAN ${CLIENT.pan}) — synthetic data.
GSTINs: Maharashtra ${OUR.MH} · Karnataka ${OUR.KA} · West Bengal ${OUR.WB}
Import files 01–11 and 13 against the Maharashtra GSTIN; file 12 against West Bengal (entity-level for 10, 11, 13).

| Reconciliation | Expected exceptions |
|---|---|
| Books vs GSTR-1 | MISSING_IN_GSTR1: ${missingInG1.join(", ")} and ${irnNotInG1}; UNDER_REPORTED_IN_GSTR1: ${taxMismatch}; GSTIN_MISMATCH: ${gstinWrong}; DUPLICATE_IN_BOOKS: ${duplicateRow.no}; MISSING_IN_BOOKS: ${notInBooks} |
| GSTR-1 vs GSTR-3B | LIABILITY_SHORT_IN_3B for 05-2026 (IGST −42,000); April shortfall of CGST/SGST 30,000 offset in June (TIMING_DIFFERENCE) |
| PR vs 2B vs 3B | CLAIMED_NOT_IN_2B ×3 (${[purchases[2], purchases[13], purchases[25]].map((p) => p.no).join(", ")}); DUPLICATE_ITC ${purchases[17].no}; IN_2B_NOT_IN_BOOKS SWIFT/9911, TECH/7781; ITC_TIME_BARRED REAGENT/OLD/77 |
| E-invoice | IRN_NOT_IN_GSTR1 for ${irnNotInG1} (and the other invoices missing in GSTR-1) |
| E-way bills | EWB_TAX_IN_CESS ×3 (${cessEwb.join(", ")}); EWB_CANCELLED_DISCARDED ${discardedEwb.join(", ")}; EWB_WITHOUT_SALE HDM/2627/8888; job-work movement HDM/JW/2627/04 |
| Imports & exports | BOE_ITC_FTWZ BOE 8047642 (ITC 8,77,051 on nil-IGST FTWZ bill of entry); EXPORT_SB_MISSING (3 invoices in Table 6A without shipping bill); EXPORT_96A_3M; ICEGATE / SB_WITHOUT_INVOICE for SB 7047799; DUTY_UNDER_PROTEST BOE 8159669 |
| Specialist checks | BLOCKED_ITC_17_5 LIFE/KM/552 (key-man insurance); RCM_IMPORT_OF_SERVICES SER/2627/632, SER/2627/1498, BP/2627/358; RCM_NOTIFIED legal fees and rent; CN_BEFORE_INVOICE and CN_HSN_DIFFERS for HDM/CN/2627/01; FA_DISPOSAL FA-0723 |
| Ledgers | CASH_LEDGER_IDLE West Bengal ₹24,75,430; NEGATIVE_ITC_BALANCE Input IGST |
`);
console.log(`Demo files written to ${OUT}`);
for (const f of fs.readdirSync(OUT)) console.log(" -", f);
