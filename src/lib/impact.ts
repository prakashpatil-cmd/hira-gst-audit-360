import { toPaise } from "@/lib/gst/money";

export interface ImpactObs {
  id: string; obs_number: number; title: string; impact_bucket: string | null; is_quantified: boolean; tax_amount: string; itc_reavailable: string;
  interest_amount: string; penalty_amount: string; recoverable_amount: string; contingent_amount: string; impact_text: string | null;
  affected_value: string | null; risk_grade: string; status: string;
}

export interface ImpactLine { obs: number; id: string; basis: string; amount: number }
export interface ImpactSummary {
  A: ImpactLine[]; B: ImpactLine[]; C: ImpactLine[]; D: ImpactLine[]; E: ImpactLine[]; F: ImpactLine[]; G: ImpactLine[]; H: ImpactLine[];
  subtotal: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H", number>;
  totalTaxPayable: number;      // A + B + C + D (quantified tax only)
  netCashBeforeInterest: number;// total − E (re-available credit), never netted against F/G/H
  interest: number;             // I
  penalty: number;              // J — disclosed separately
  unquantified: { obs: number; id: string; title: string; text: string }[];
}

/**
 * Builds the "Financial Impact at a Glance" table. Unquantified items are listed, never added;
 * recoverable balances and cash ledger transfers are shown separately and never netted against tax.
 * All amounts in paise.
 */
export function summariseImpact(obs: ImpactObs[]): ImpactSummary {
  const s: ImpactSummary = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [],
    subtotal: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 }, totalTaxPayable: 0, netCashBeforeInterest: 0, interest: 0, penalty: 0, unquantified: [] };
  const push = (k: keyof ImpactSummary["subtotal"], o: ImpactObs, amount: number) => {
    if (!amount) return;
    s[k].push({ obs: o.obs_number, id: o.id, basis: o.title, amount });
    s.subtotal[k] += amount;
  };
  for (const o of [...obs].sort((a, b) => a.obs_number - b.obs_number)) {
    const b = o.impact_bucket ?? "NONE";
    const tax = toPaise(o.tax_amount), rec = toPaise(o.recoverable_amount), cont = toPaise(o.contingent_amount);
    if (b === "A_ITC_REVERSAL") push("A", o, tax);
    else if (b === "B_RCM_OUTPUT_SHORTFALL") push("B", o, tax);
    else if (b === "C_CREDIT_NOTE") push("C", o, tax);
    else if (b === "D_OTHER_LIABILITY") push("D", o, tax);
    else if (b === "G_RECOVERABLE") push("G", o, rec || tax);
    else if (b === "H_CASH_TRANSFER") push("H", o, rec || tax);
    if (cont) push("F", o, cont);
    else if (b === "F_CONTINGENT") push("F", o, tax);
    push("E", o, toPaise(o.itc_reavailable));
    s.interest += toPaise(o.interest_amount);
    s.penalty += toPaise(o.penalty_amount);
    if (!o.is_quantified) s.unquantified.push({ obs: o.obs_number, id: o.id, title: o.title, text: o.impact_text ?? "To be quantified" });
  }
  s.totalTaxPayable = s.subtotal.A + s.subtotal.B + s.subtotal.C + s.subtotal.D;
  s.netCashBeforeInterest = s.totalTaxPayable - s.subtotal.E;
  return s;
}
