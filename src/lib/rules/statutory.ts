/**
 * Statutory time limits, limitation, interest and penalty calculators.
 *
 * Every function returns the legal basis it applied and a `legalReviewRequired` flag. Parameters
 * (rates, caps, day counts) come from approved rule_definitions when available; the defaults below
 * mirror those seeded rules. Nothing here is a final legal conclusion — results are inputs for the
 * auditor's professional judgement.
 */
import { addMonths, financialYear, fyBounds, daysBetween, ymd } from "@/lib/gst/dates";
import { roundHalfUp, type Paise } from "@/lib/gst/money";

export interface RuleParams { [k: string]: number | string | boolean }
export interface CalcBasis { ruleCode: string; ruleVersion: number | null; basis: string; legalReviewRequired: boolean; notes: string[] }

export const ENGINE_VERSION = "2026.10.1";

/** Due date of the annual return (GSTR-9): 31 December following the end of the financial year. */
export function annualReturnDueDate(fy: string): string {
  const end = fyBounds(fy).to;                       // 31 March
  return ymd(+end.slice(0, 4), 12, 31);
}

/**
 * Section 16(4) / 34(2) / 37(3) cut-off for a document of a given financial year: 30 November
 * following the end of the FY, or the date the annual return is furnished, whichever is earlier
 * (as amended by the Finance Act 2022 w.e.f. 01.10.2022, applicable from FY 2021-22). For earlier
 * years the cut-off was the due date of the September return following the FY (20 October).
 */
export function yearEndCutoff(docDate: string, annualReturnFiledOn?: string | null): { date: string } & CalcBasis {
  const fy = financialYear(docDate);
  const fyEndYear = +fyBounds(fy).to.slice(0, 4);
  const amended = +fy.slice(0, 4) >= 2021;
  let date = amended ? ymd(fyEndYear, 11, 30) : ymd(fyEndYear, 10, 20);
  const notes: string[] = [];
  if (annualReturnFiledOn && annualReturnFiledOn < date) { date = annualReturnFiledOn; notes.push("Annual return filed before the 30 November cut-off; the earlier date applies."); }
  if (!amended) notes.push("Pre-amendment period: cut-off taken as due date of September GSTR-3B (20 October). Verify for QRMP filers.");
  return { date, ruleCode: amended ? "LIM-YE-CUTOFF" : "LIM-YE-CUTOFF-PRE2022", ruleVersion: null,
    basis: amended ? "Section 16(4)/34(2)/37(3) CGST Act as amended by Finance Act 2022" : "Section 16(4)/34(2)/37(3) CGST Act (pre-01.10.2022)",
    legalReviewRequired: !amended, notes };
}

/** True when ITC on the invoice was (or would be) claimed after the Section 16(4) cut-off. */
export function itcTimeBarred(invoiceDate: string, claimPeriod: string | null, asOf: string, annualReturnFiledOn?: string | null) {
  const cut = yearEndCutoff(invoiceDate, annualReturnFiledOn);
  // ITC is availed in the GSTR-3B for claimPeriod, filed by the 20th of the following month at the earliest.
  const claimedBy = claimPeriod ? addMonths(claimPeriod, 1).slice(0, 8) + "20" : asOf;
  return { barred: claimedBy > cut.date, cutoff: cut.date, claimedBy, ...cut };
}

/** GSTR-3B due date for a monthly return period (20th of the following month; configurable). */
export function gstr3bDueDate(period: string, params: RuleParams = {}): string {
  const day = Number(params.due_day ?? 20);
  const next = addMonths(period.slice(0, 8) + "01", 1);
  return next.slice(0, 8) + String(day).padStart(2, "0");
}

export interface InterestInput {
  amount: Paise;                       // tax (or ITC wrongly availed and utilised)
  from: string;                        // due date (interest runs from the next day)
  to: string;                          // date of payment / computation date
  provision: "50(1)" | "50(3)";
  params?: RuleParams;
}

/** Simple interest at the notified rate on a day basis (365-day year), rounded to the rupee. */
export function interestS50(i: InterestInput): { interest: Paise; days: number; ratePct: number } & CalcBasis {
  const ratePct = Number(i.params?.rate_pa ?? 18);
  const days = Math.max(0, daysBetween(i.from, i.to));
  const raw = (i.amount * ratePct * days) / (100 * 365);
  const interest = roundHalfUp(raw / 100) * 100;     // whole rupees
  const notes: string[] = [];
  if (i.provision === "50(3)") notes.push("Interest under Section 50(3) applies only to ITC wrongly availed AND utilised (Rule 88B(3)); confirm utilisation from the electronic credit ledger.");
  if (days === 0) notes.push("No delay computed.");
  return { interest, days, ratePct, ruleCode: i.provision === "50(1)" ? "INT-S50-1" : "INT-S50-3", ruleVersion: null,
    basis: `Section ${i.provision} CGST Act, ${ratePct}% p.a. for ${days} days`, legalReviewRequired: false, notes };
}

export type DemandRegime = "S73" | "S74" | "S74A";

/**
 * Selects the demand provision by the financial year of the tax period:
 * FY 2017-18 to 2023-24 → Sections 73/74; FY 2024-25 onwards → Section 74A (Finance (No. 2) Act 2024).
 */
export function demandLimitation(fy: string, fraud: boolean, params: RuleParams = {}) {
  const arDue = annualReturnDueDate(fy);
  const start = +fy.slice(0, 4);
  const notes: string[] = [];
  if (start >= Number(params.s74a_from_fy_start ?? 2024)) {
    const scnBy = addMonths(arDue, Number(params.s74a_scn_months ?? 42));
    notes.push("Order to be issued within 12 months of the notice (extendable by up to 6 months) — Section 74A(10)/(11).");
    return { regime: "S74A" as DemandRegime, scnBy, orderBy: addMonths(scnBy, 12), annualReturnDue: arDue,
      ruleCode: "LIM-S74A", ruleVersion: null, basis: `Section 74A CGST Act — FY ${fy}${fraud ? " (fraud / suppression)" : ""}`,
      legalReviewRequired: false, notes };
  }
  const years = fraud ? 5 : 3;
  const orderBy = addMonths(arDue, years * 12);
  const scnBy = addMonths(orderBy, fraud ? -6 : -3);
  notes.push("Extensions of time notified for FY 2017-18 to 2019-20 (Section 168A) may alter these dates — verify.");
  return { regime: (fraud ? "S74" : "S73") as DemandRegime, scnBy, orderBy, annualReturnDue: arDue,
    ruleCode: fraud ? "LIM-S74" : "LIM-S73", ruleVersion: null, basis: `Section ${fraud ? 74 : 73} CGST Act — FY ${fy}`,
    legalReviewRequired: start <= 2019, notes };
}

/**
 * Potential penalty (disclosed separately, never netted into tax). Mirrors:
 *  S73 / S74A non-fraud: higher of 10% of tax or ₹10,000;  S74 / S74A fraud: equal to tax.
 * Reduced penalties for voluntary/early payment are noted but not applied.
 */
export function potentialPenalty(regime: DemandRegime, fraud: boolean, taxAmount: Paise, params: RuleParams = {}) {
  const minPaise = Number(params.min_penalty_rupees ?? 10000) * 100;
  const pct = Number(params.non_fraud_pct ?? 10);
  const penalty = fraud || regime === "S74" ? taxAmount : Math.max(roundHalfUp((taxAmount * pct) / 100), taxAmount > 0 ? minPaise : 0);
  return { penalty, ruleCode: `PEN-${regime}${fraud ? "-FRAUD" : ""}`, ruleVersion: null,
    basis: fraud || regime === "S74" ? `Penalty equal to tax — Section ${regime === "S74A" ? "74A" : "74"}` : `Higher of ${pct}% of tax or ₹10,000 — Section ${regime === "S74A" ? "74A" : "73"}`,
    legalReviewRequired: true,
    notes: ["Potential exposure only; reduced or nil penalty may apply on payment before notice/order — subject to professional review."] };
}

/** Appeal timelines and pre-deposit (parameters require Super Administrator approval in the rule console). */
export function appealTerms(forum: "APL-01" | "GSTAT", orderDate: string, disputedTax: Paise, params: RuleParams = {}) {
  const months = Number(params.months ?? 3);
  const pct = Number(params.pre_deposit_pct ?? (forum === "APL-01" ? 10 : 10));
  return { appealBy: addMonths(orderDate, months), condonableTo: addMonths(orderDate, months + (forum === "APL-01" ? 1 : 3)),
    preDeposit: roundHalfUp((disputedTax * pct) / 100), ruleCode: forum === "APL-01" ? "APL-S107" : "APL-S112", ruleVersion: null,
    basis: forum === "APL-01" ? "Section 107 CGST Act" : "Section 112 CGST Act",
    legalReviewRequired: true, notes: ["Pre-deposit percentage and monetary caps must be confirmed against the provision in force on the date of appeal."] };
}

/** Section 18(6) / Rule 44(6): tax on disposal of capital goods = higher of (ITC − 5% per quarter) and tax on transaction value. */
export function capitalGoodsDisposalTax(itcTaken: Paise, capitalisedOn: string, disposedOn: string, taxOnTransactionValue: Paise) {
  const quarters = Math.ceil(Math.max(0, daysBetween(capitalisedOn, disposedOn)) / 91.3125);
  const reduced = Math.max(0, itcTaken - roundHalfUp((itcTaken * 5 * quarters) / 100));
  return { payable: Math.max(reduced, taxOnTransactionValue), itcBased: reduced, quarters, transactionBased: taxOnTransactionValue,
    ruleCode: "S18-6-R44-6", ruleVersion: null, basis: "Section 18(6) CGST Act read with Rule 44(6)", legalReviewRequired: false,
    notes: ["Quarters of use counted as part-quarters (ceil); confirm against the asset's actual put-to-use date."] };
}
