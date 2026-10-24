import { describe, expect, it } from "vitest";
import { summariseImpact, type ImpactObs } from "@/lib/impact";
import { toPaise } from "@/lib/gst/money";

const o = (n: number, bucket: string, tax: string, extra: Partial<ImpactObs> = {}): ImpactObs => ({
  id: `o${n}`, obs_number: n, title: `Obs ${n}`, impact_bucket: bucket, is_quantified: true, tax_amount: tax, itc_reavailable: "0", interest_amount: "0",
  penalty_amount: "0", recoverable_amount: "0", contingent_amount: "0", impact_text: null, affected_value: null, risk_grade: "high", status: "approved", ...extra });

describe("Financial impact at a glance (Tosoh regression figures)", () => {
  it("reproduces A/B/C totals, E offset, contingent and recoverable separation without netting", () => {
    const s = summariseImpact([
      o(16, "A_ITC_REVERSAL", "8770510"), o(29, "A_ITC_REVERSAL", "45781"), o(33, "A_ITC_REVERSAL", "36000"),
      o(23, "B_RCM_OUTPUT_SHORTFALL", "502311", { itc_reavailable: "502311" }), o(24, "B_RCM_OUTPUT_SHORTFALL", "15403", { itc_reavailable: "15403" }),
      o(25, "B_RCM_OUTPUT_SHORTFALL", "212004", { itc_reavailable: "212004" }), o(26, "B_RCM_OUTPUT_SHORTFALL", "9276"),
      o(32, "B_RCM_OUTPUT_SHORTFALL", "2081"), o(34, "B_RCM_OUTPUT_SHORTFALL", "30694", { itc_reavailable: "30694" }),
      o(1, "C_CREDIT_NOTE", "2021"), o(2, "C_CREDIT_NOTE", "2021"),
      o(31, "F_CONTINGENT", "0", { contingent_amount: "425485" }), o(30, "F_CONTINGENT", "0", { contingent_amount: "1477" }),
      o(17, "H_CASH_TRANSFER", "0", { recoverable_amount: "2475430" }),
      o(13, "NONE", "0", { is_quantified: false, impact_text: "₹8,52,97,237 turnover affected" }),
    ]);
    expect(s.subtotal.A).toBe(toPaise("8852291"));
    expect(s.subtotal.B).toBe(toPaise("771769"));
    expect(s.subtotal.C).toBe(toPaise("4042"));
    expect(s.totalTaxPayable).toBe(toPaise("9628102"));
    expect(s.subtotal.E).toBe(toPaise("760412"));
    expect(s.netCashBeforeInterest).toBe(toPaise("8867690"));
    expect(s.subtotal.F).toBe(toPaise("426962"));
    expect(s.subtotal.H).toBe(toPaise("2475430"));
    expect(s.unquantified.map((u) => u.obs)).toEqual([13]);
  });
});
