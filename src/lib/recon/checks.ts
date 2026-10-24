/**
 * Specialist rule-based checks (RCM, blocked credit, credit notes, rates, tax heads, fixed assets).
 * Keyword-based classifications are always "probable" or "requires investigation": they point the
 * auditor to transactions to examine; they never conclude on their own.
 */
import { formatINR, taxAtRate, type Paise } from "@/lib/gst/money";
import { validateGstin } from "@/lib/gst/gstin";
import { yearEndCutoff, capitalGoodsDisposalTax, interestS50 } from "@/lib/rules/statutory";
import { addMonths } from "@/lib/gst/dates";
import type { RDoc } from "./match";
import type { ExceptionDraft, GstinData, LedgerRow, ReconContext, ReconOutput } from "./types";
import { zeroDiff } from "./types";

const R = (p: Paise) => `₹${formatINR(p)}`;

// ---- Section 17(5) blocked credits ------------------------------------------------------------
export const BLOCKED_PATTERNS: { clause: string; label: string; re: RegExp }[] = [
  { clause: "17(5)(a)", label: "motor vehicle", re: /\b(motor\s*car|car\s*purchase|vehicle\s*purchase|suv|sedan)\b/i },
  { clause: "17(5)(b)(i)", label: "food and beverages / outdoor catering", re: /\b(food|canteen|catering|beverage|restaurant|meals?|refreshment|lunch|dinner|snacks?)\b/i },
  { clause: "17(5)(b)(i)", label: "beauty treatment / health services / cosmetic surgery", re: /\b(beauty|salon|spa|cosmetic|plastic surgery|health check.?up|medical services)\b/i },
  { clause: "17(5)(b)(i)", label: "life or health insurance", re: /\b(life insurance|health insurance|mediclaim|group term|key\s*man|keyman|gpa|group personal accident|medical insurance)\b/i },
  { clause: "17(5)(a)/(ab)", label: "rent-a-cab / motor vehicle hire or repair", re: /\b(rent.?a.?cab|cab hire|taxi|car hire|car rental|car lease|vehicle hire|vehicle repair|car repair|car maintenance)\b/i },
  { clause: "17(5)(b)(ii)", label: "club / health and fitness membership", re: /\b(club membership|club fees|gym|fitness|health club)\b/i },
  { clause: "17(5)(b)(iii)", label: "travel benefits to employees on vacation", re: /\b(leave travel|ltc|holiday package|vacation)\b/i },
  { clause: "17(5)(c)/(d)", label: "works contract / construction of immovable property", re: /\b(civil work|construction|building work|works contract|capital work.?in.?progress|cwip)\b/i },
  { clause: "17(5)(h)", label: "gifts / free samples / goods written off", re: /\b(gift|diwali|free sample|samples? distribution|written off|write.?off|lost|destroyed|stolen)\b/i },
];

export function blockedCreditMatch(text: string): { clause: string; label: string } | null {
  for (const p of BLOCKED_PATTERNS) if (p.re.test(text)) return { clause: p.clause, label: p.label };
  return null;
}

// ---- Reverse charge ---------------------------------------------------------------------------
export const RCM_FOREIGN = /\b(usd|eur|euro|jpy|gbp|sgd|aed|foreign|overseas|remittance|swift|outward remittance|parent company|head office abroad|japan|germany|usa|singapore)\b/i;
export const SERVICE_EXPENSE = /\b(software|subscription|licen[cs]e|saas|cloud|consult|professional|technical|royalty|testing|training|warranty|insurance|exhibition|advertis|marketing|sponsor|management fee|support fee|commission|legal|audit fee|it services|maintenance)\b/i;
export const RCM_NOTIFIED: { label: string; re: RegExp; rate: number; ref: string }[] = [
  { label: "goods transport agency (GTA)", re: /\b(gta|freight|transport(ation)? charges|lorry|truck hire|carriage inward|cartage)\b/i, rate: 5, ref: "Notification 13/2017-CT(R), entry 1 (5% unless GTA opted for forward charge)" },
  { label: "legal services by an advocate / firm of advocates", re: /\b(advocate|legal fees?|legal expenses|law firm|counsel fees?|solicitor)\b/i, rate: 18, ref: "Notification 13/2017-CT(R), entry 2" },
  { label: "director's services", re: /\b(sitting fees?|director'?s? (fees|remuneration|commission))\b/i, rate: 18, ref: "Notification 13/2017-CT(R), entry 6" },
  { label: "security services by a non-body-corporate", re: /\b(security (services|charges|guard)|watch and ward)\b/i, rate: 18, ref: "Notification 13/2017-CT(R), entry 14" },
  { label: "sponsorship services", re: /\b(sponsorship)\b/i, rate: 18, ref: "Notification 13/2017-CT(R), entry 4" },
  { label: "renting of property by an unregistered person", re: /\b(rent|lease rent|office rent|godown rent|warehouse rent)\b/i, rate: 18, ref: "Notification 13/2017-CT(R) (renting of residential dwelling / commercial property entries)" },
];

function ex(e: Omit<ExceptionDraft, "diff" | "sourceIds"> & Partial<Pick<ExceptionDraft, "diff" | "sourceIds">>): ExceptionDraft {
  return { diff: e.diff ?? zeroDiff(), sourceIds: e.sourceIds ?? [], ...e };
}

export function runSpecialChecks(data: GstinData, entityLedgers: LedgerRow[], ctx: ReconContext): ReconOutput {
  const exceptions: ExceptionDraft[] = [];

  // ---------- Blocked credit (purchase register) ----------
  for (const d of data.purchases) {
    const itc = Number(d.meta?.itcTotal ?? 0);
    if (itc <= 0 || /inelig|blocked/i.test(String(d.meta?.category ?? ""))) continue;
    const text = [d.meta?.ledger, d.meta?.description, d.name].filter(Boolean).join(" ");
    const hit = blockedCreditMatch(text) ?? (String(d.meta?.hsn ?? "").startsWith("8703") ? { clause: "17(5)(a)", label: "motor vehicle (HSN 8703)" } : null);
    if (hit) exceptions.push(ex({ module: "C", type: "BLOCKED_ITC_17_5", severity: "medium", classification: "probable",
      docNo: d.docNo, docDate: d.docDate, gstin: d.gstin, name: d.name, period: d.period, sourceIds: [d.id],
      diff: { ...zeroDiff(), igst: Number(d.meta?.itcIgst ?? 0), cgst: Number(d.meta?.itcCgst ?? 0), sgst: Number(d.meta?.itcSgst ?? 0), tax: itc },
      description: `ITC of ${R(itc)} claimed on ${d.docNo} (${text.slice(0, 80)}) appears to relate to ${hit.label} — blocked under Section ${hit.clause} unless an exception applies.` }));
  }

  // ---------- Reverse charge from the general ledger ----------
  const rcmBooked = new Set(data.purchases.filter((d) => d.meta?.rcm).map((d) => `${String(d.meta?.voucher ?? "")}`.toUpperCase()).filter(Boolean));
  const gl = entityLedgers.filter((l) => l.source === "general_ledger" && l.debit > 0);
  for (const l of gl) {
    const voucher = String(l.extra.voucher_ref ?? "").toUpperCase();
    if (voucher && rcmBooked.has(voucher)) continue;
    const text = `${l.name} ${l.group ?? ""} ${l.extra.narration ?? ""} ${l.extra.party ?? ""}`;
    const currency = String(l.extra.currency ?? "").toUpperCase();
    const country = String(l.extra.party_country ?? "").toLowerCase();
    const foreign = (currency && currency !== "INR") || (country && country !== "india" && country !== "in") || RCM_FOREIGN.test(text);
    const date = String(l.extra.doc_date ?? l.period ?? "");
    if (foreign && SERVICE_EXPENSE.test(text)) {
      const tax = taxAtRate(l.debit, 18);
      const due = date ? addMonths(date.slice(0, 8) + "01", 1).slice(0, 8) + "20" : null;
      const interest = due ? interestS50({ amount: tax, from: due, to: ctx.asOf, provision: "50(1)" }) : null;
      exceptions.push(ex({ module: "D", type: "RCM_IMPORT_OF_SERVICES", severity: tax >= ctx.materiality ? "high" : "medium", classification: "probable",
        docNo: voucher || null, docDate: date || null, name: String(l.extra.party ?? "") || null, period: l.period, sourceIds: [l.id],
        diff: { ...zeroDiff(), taxable: l.debit, igst: tax, tax },
        description: `Voucher ${voucher || "—"} (${l.name}) records a payment of ${R(l.debit)} to an overseas party; IGST under reverse charge of ${R(tax)} at 18% (rate assumed — confirm classification) does not appear to have been discharged (Section 5(3) IGST Act; import of services).` +
          (interest ? ` Indicative interest to ${ctx.asOf}: ${R(interest.interest)}.` : "") }));
      continue;
    }
    for (const n of RCM_NOTIFIED) {
      if (!n.re.test(text)) continue;
      const tax = taxAtRate(l.debit, n.rate);
      exceptions.push(ex({ module: "D", type: "RCM_NOTIFIED", severity: "medium", classification: "requires_investigation",
        docNo: voucher || null, docDate: date || null, name: String(l.extra.party ?? "") || null, period: l.period, sourceIds: [l.id],
        diff: { ...zeroDiff(), taxable: l.debit, tax },
        description: `Voucher ${voucher || "—"} (${l.name}): expense resembling ${n.label}; if the supplier's status brings it under ${n.ref}, tax of about ${R(tax)} at ${n.rate}% is payable under reverse charge.` }));
      break;
    }
  }

  // ---------- Credit notes (outward) ----------
  const salesByNo = new Map(data.sales.map((d) => [d.docNoNorm, d]));
  const g1Notes = new Map(data.gstr1.filter((d) => d.docType === "CRN").map((d) => [d.docNoNorm, d]));
  for (const n of data.salesNotes.filter((x) => x.docType === "CRN")) {
    const origNo = String(n.meta?.originalNo ?? "");
    const origDate = (n.meta?.originalDate as string | null) ?? salesByNo.get(String(n.meta?.originalNoNorm ?? ""))?.docDate ?? null;
    const orig = salesByNo.get(String(n.meta?.originalNoNorm ?? ""));
    const base = { docNo: n.docNo, docDate: n.docDate, gstin: n.gstin, name: n.name, period: n.period, sourceIds: [n.id, ...(orig ? [orig.id] : [])] };
    const taxD = { ...zeroDiff(), taxable: n.taxable, igst: n.igst, cgst: n.cgst, sgst: n.sgst, cess: n.cess, tax: n.igst + n.cgst + n.sgst + n.cess };
    if (!origNo) {
      exceptions.push(ex({ module: "B", type: "CN_WITHOUT_ORIGINAL_REF", severity: "low", classification: "documentary_deficiency", ...base,
        description: `Credit note ${n.docNo} does not carry the original invoice reference required by Rule 53(1A); the Section 34 linkage cannot be demonstrated.` }));
      continue;
    }
    if (origDate && n.docDate && n.docDate < origDate) exceptions.push(ex({ module: "B", type: "CN_BEFORE_INVOICE", severity: "high", classification: "probable", ...base, diff: taxD,
      description: `Credit note ${n.docNo} dated ${n.docDate} predates the invoice ${origNo} it adjusts (${origDate}); a credit note presupposes a completed supply — Section 34(1).` }));
    if (origDate) {
      const cut = yearEndCutoff(origDate, ctx.annualReturnFiledOn);
      const declared = g1Notes.get(n.docNoNorm)?.period ?? n.period;
      const declaredBy = declared ? addMonths(declared, 1).slice(0, 8) + "11" : n.docDate;
      if (declaredBy && declaredBy > cut.date) exceptions.push(ex({ module: "B", type: "CN_TIME_LIMIT_34_2", severity: "high", classification: "probable", ...base, diff: taxD,
        description: `Credit note ${n.docNo} against invoice ${origNo} dated ${origDate} was declared after the Section 34(2) cut-off of ${cut.date}; the reduction of output tax of ${R(taxD.tax)} is not admissible.` }));
    }
    if (orig && n.meta?.hsn && orig.meta?.hsn && n.meta.hsn !== orig.meta.hsn) exceptions.push(ex({ module: "B", type: "CN_HSN_DIFFERS", severity: "medium", classification: "probable", ...base,
      description: `Credit note ${n.docNo} carries HSN ${n.meta.hsn} whereas the original invoice ${origNo} carries HSN ${orig.meta.hsn}; the two documents do not describe the same goods.` }));
  }

  // ---------- Rate consistency per HSN (outward) ----------
  const byHsn = new Map<string, Map<number, number>>();
  for (const d of data.sales) {
    const h = String(d.meta?.hsn ?? ""); if (!h || d.rate == null) continue;
    const m = byHsn.get(h) ?? new Map<number, number>();
    m.set(d.rate, (m.get(d.rate) ?? 0) + d.taxable);
    byHsn.set(h, m);
  }
  for (const d of data.sales) {
    const h = String(d.meta?.hsn ?? ""); if (!h || d.rate == null) continue;
    const m = byHsn.get(h)!;
    if (m.size < 2) continue;
    const [major] = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
    if (d.rate === major || isZero(d)) continue;
    const short = taxAtRate(d.taxable, major) - (d.igst + d.cgst + d.sgst);
    exceptions.push(ex({ module: "B", type: "WRONG_RATE", severity: short > 0 ? "medium" : "low", classification: "requires_investigation",
      docNo: d.docNo, docDate: d.docDate, gstin: d.gstin, name: d.name, period: d.period, sourceIds: [d.id],
      diff: { ...zeroDiff(), tax: Math.max(0, short) },
      description: `Invoice ${d.docNo}: HSN ${h} charged at ${d.rate}% whereas the predominant rate for this HSN is ${major}%${short > 0 ? `; potential short levy ${R(short)}` : ""}. Confirm classification.` }));
  }

  // ---------- Counterparty GSTIN validity ----------
  for (const d of [...data.sales, ...data.purchases]) {
    if (!d.gstin) continue;
    const v = validateGstin(d.gstin);
    if (!v.valid) exceptions.push(ex({ module: d.meta?.source === "purchase" ? "C" : "B", type: "INVALID_GSTIN", severity: "medium", classification: "confirmed",
      docNo: d.docNo, docDate: d.docDate, gstin: d.gstin, name: d.name, period: d.period, sourceIds: [d.id],
      description: `${d.meta?.source === "purchase" ? "Supplier" : "Recipient"} GSTIN ${d.gstin} on ${d.docNo} is invalid (${v.reason}).` }));
  }

  // ---------- Tax head vs place of supply (outward) ----------
  const ourState = data.gstin?.slice(0, 2);
  for (const d of data.sales) {
    if (!ourState || !d.meta?.pos || isZero(d)) continue;
    const intra = d.meta.pos === ourState;
    if ((intra && d.igst > 0) || (!intra && d.cgst + d.sgst > 0)) exceptions.push(ex({ module: "B", type: "WRONG_TAX_HEAD", severity: "high", classification: "probable",
      docNo: d.docNo, docDate: d.docDate, gstin: d.gstin, name: d.name, period: d.period, sourceIds: [d.id],
      diff: { ...zeroDiff(), tax: intra ? d.igst : d.cgst + d.sgst },
      description: `Invoice ${d.docNo}: place of supply ${d.meta.pos} ${intra ? "is within" : "is outside"} the supplier's state but ${intra ? "IGST" : "CGST/SGST"} of ${R(intra ? d.igst : d.cgst + d.sgst)} was charged; tax paid under the wrong head must be paid under the correct head (refund under Section 77 / Section 19 IGST Act).` }));
  }

  // ---------- Fixed asset disposals (Section 18(6) / Rule 44(6)) ----------
  const salesByBuyer = data.sales;
  for (const a of entityLedgers.filter((l) => l.source === "fixed_asset_register" && l.extra.disposal_date)) {
    const disposed = String(a.extra.disposal_date);
    if (disposed < ctx.periodFrom || disposed > ctx.periodTo) continue;
    const consideration = a.credit;
    const itc = Number(a.extra.itc_availed_paise ?? 0);
    const cap = a.extra.capitalisation_date ? String(a.extra.capitalisation_date) : null;
    const onValue = taxAtRate(consideration, 18);
    const calc = cap && itc ? capitalGoodsDisposalTax(itc, cap, disposed, onValue) : null;
    const invoiced = salesByBuyer.some((s) => s.docDate && Math.abs(Date.parse(s.docDate) - Date.parse(disposed)) < 15 * 86400000
      && Math.abs(s.taxable - consideration) <= Math.max(ctx.tolerance, Math.round(consideration * 0.01)));
    if (invoiced) continue;
    const payable = calc?.payable ?? onValue;
    exceptions.push(ex({ module: "L", type: "FA_DISPOSAL", severity: payable >= ctx.materiality ? "high" : "low", classification: calc ? "probable" : "requires_investigation",
      docNo: String(a.extra.voucher_ref ?? a.name), docDate: disposed, period: disposed.slice(0, 8) + "01", sourceIds: [a.id],
      diff: { ...zeroDiff(), taxable: consideration, tax: payable },
      description: `Fixed asset "${a.name}" disposed on ${disposed} for ${R(consideration)} with no matching tax invoice in the sales register. ` +
        (calc ? `Tax under Section 18(6)/Rule 44(6): higher of ${R(calc.itcBased)} (ITC less 5% × ${calc.quarters} quarters) and ${R(calc.transactionBased)} = ${R(calc.payable)}.`
              : `Indicative tax at 18% on recorded value ${R(onValue)} — contingent pending asset details.`) }));
  }
  return { matches: [], exceptions, summary: { checks: exceptions.length } };
}

function isZero(d: RDoc) {
  return /export|sez|exempt|nil|non.?gst|deemed/i.test(String(d.meta?.supplyType ?? "")) || d.meta?.pos === "96";
}
