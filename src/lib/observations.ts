import "server-only";
import { createHash } from "node:crypto";
import type { Tx } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/permissions";
import { toPaise, paiseToDecimal, formatINR } from "@/lib/gst/money";
import { financialYear, todayIso, fmtDate } from "@/lib/gst/dates";
import { gstr3bDueDate, interestS50, demandLimitation, potentialPenalty, ENGINE_VERSION } from "@/lib/rules/statutory";

export const IMPACT_BUCKETS: Record<string, string> = {
  A_ITC_REVERSAL: "A. Input tax credit wrongly availed — to be reversed",
  B_RCM_OUTPUT_SHORTFALL: "B. Reverse charge and output tax not discharged",
  C_CREDIT_NOTE: "C. Output tax on inadmissible credit notes",
  D_OTHER_LIABILITY: "D. Other potential statutory tax liabilities",
  E_ITC_REAVAILABLE: "E. Input tax credit re-available on discharge",
  F_CONTINGENT: "F. Contingent and unquantified exposures",
  G_RECOVERABLE: "G. Recoverable amounts and refund opportunities",
  H_CASH_TRANSFER: "H. Electronic cash balances available for permitted transfer",
  NONE: "No direct tax impact (procedural / documentary)",
};

const BUCKET_BY_TYPE: Record<string, string> = {
  CLAIMED_NOT_IN_2B: "A_ITC_REVERSAL", CLAIMED_ITC_NOT_AVAILABLE: "A_ITC_REVERSAL", EXCESS_ITC_OVER_2B: "A_ITC_REVERSAL", DUPLICATE_ITC: "A_ITC_REVERSAL",
  ITC_TIME_BARRED: "A_ITC_REVERSAL", SUPPLIER_CN_NOT_BOOKED: "A_ITC_REVERSAL", BLOCKED_ITC_17_5: "A_ITC_REVERSAL", BOE_ITC_FTWZ: "A_ITC_REVERSAL",
  BOE_EXCESS_ITC: "A_ITC_REVERSAL", IMPORT_ITC_WITHOUT_BOE: "A_ITC_REVERSAL", ITC_3B_EXCEEDS_2B: "A_ITC_REVERSAL",
  RCM_IMPORT_OF_SERVICES: "B_RCM_OUTPUT_SHORTFALL", RCM_NOTIFIED: "B_RCM_OUTPUT_SHORTFALL", MISSING_IN_GSTR1: "B_RCM_OUTPUT_SHORTFALL",
  UNDER_REPORTED_IN_GSTR1: "B_RCM_OUTPUT_SHORTFALL", LIABILITY_SHORT_IN_3B: "B_RCM_OUTPUT_SHORTFALL", B2C_UNDER_REPORTED: "B_RCM_OUTPUT_SHORTFALL",
  IRN_NOT_IN_GSTR1: "B_RCM_OUTPUT_SHORTFALL", WRONG_RATE: "B_RCM_OUTPUT_SHORTFALL", TIMING_DIFFERENCE: "D_OTHER_LIABILITY",
  CN_TIME_LIMIT_34_2: "C_CREDIT_NOTE", CN_BEFORE_INVOICE: "C_CREDIT_NOTE", CN_IN_GSTR1_NOT_IN_BOOKS: "C_CREDIT_NOTE", CN_HSN_DIFFERS: "C_CREDIT_NOTE",
  FA_DISPOSAL: "F_CONTINGENT", EXPORT_96A_3M: "F_CONTINGENT", WRONG_TAX_HEAD: "D_OTHER_LIABILITY", TAX_HEAD_MISMATCH: "D_OTHER_LIABILITY",
  MATCHED_UNCLAIMED: "G_RECOVERABLE", IN_2B_NOT_IN_BOOKS: "G_RECOVERABLE", LIABILITY_EXCESS_IN_3B: "G_RECOVERABLE", DUPLICATE_IN_GSTR1: "G_RECOVERABLE",
  OVER_REPORTED_IN_GSTR1: "G_RECOVERABLE", CN_NOT_IN_GSTR1: "G_RECOVERABLE", DUTY_UNDER_PROTEST: "G_RECOVERABLE", B2C_OVER_REPORTED: "G_RECOVERABLE",
  CASH_LEDGER_IDLE: "H_CASH_TRANSFER",
};
const RCM_TYPES = new Set(["RCM_IMPORT_OF_SERVICES", "RCM_NOTIFIED"]);
const CATEGORY: Record<string, string> = {
  A: "Registration / General", B: "Outward Supply / Output Tax", C: "Input Tax Credit", D: "RCM Default", E: "ISD / Cross Charge", F: "E-Invoice",
  G: "E-Way Bill", H: "Export / Zero-Rating", I: "SEZ / FTWZ", J: "Imports / Customs", K: "Job Work", L: "Fixed Assets", M: "Ledgers / Working Capital",
  N: "Annual Return / Reconciliation", O: "Interest / Limitation", P: "Litigation", Q: "Specialised Compliance",
};

export function bucketFor(type: string): string { return BUCKET_BY_TYPE[type] ?? "D_OTHER_LIABILITY"; }

interface ExRow {
  id: string; exception_type: string; module: string; control_id: string | null; severity: string; classification: string | null; description: string;
  doc_no: string | null; doc_date: string | null; period: string | null; counterparty_name: string | null; counterparty_gstin: string | null;
  client_gstin_id: string | null; diff_taxable: string; diff_igst: string; diff_cgst: string; diff_sgst: string; diff_cess: string; diff_tax: string; source_ids: string[];
}

/**
 * Computes the financial implication for a set of exceptions with the deterministic engine and
 * stores it as an immutable snapshot. Interest runs from the GSTR-3B due date of each item's
 * period to the computation date; penalty is a separate, potential figure.
 */
export async function computeImpact(tx: Tx, user: SessionUser, engagementId: string, items: ExRow[], bucket: string, asOf = todayIso()) {
  const lines = items.map((x) => {
    const tax = toPaise(x.diff_tax);
    const positive = Math.max(0, tax);
    const dueFrom = x.period ? gstr3bDueDate(x.period) : x.doc_date ? gstr3bDueDate(x.doc_date.slice(0, 8) + "01") : null;
    const interestable = ["A_ITC_REVERSAL", "B_RCM_OUTPUT_SHORTFALL", "C_CREDIT_NOTE", "D_OTHER_LIABILITY"].includes(bucket) && positive > 0 && dueFrom;
    const int = interestable ? interestS50({ amount: positive, from: dueFrom!, to: asOf, provision: bucket === "A_ITC_REVERSAL" ? "50(3)" : "50(1)" }) : null;
    return { exceptionId: x.id, docNo: x.doc_no, period: x.period, tax: positive, igst: Math.max(0, toPaise(x.diff_igst)), cgst: Math.max(0, toPaise(x.diff_cgst)),
      sgst: Math.max(0, toPaise(x.diff_sgst)), cess: Math.max(0, toPaise(x.diff_cess)), absTax: Math.abs(tax), taxable: toPaise(x.diff_taxable),
      interestFrom: interestable ? dueFrom : null, interest: int?.interest ?? 0, days: int?.days ?? 0, basis: int?.basis ?? null };
  });
  const sum = (k: keyof (typeof lines)[number]) => lines.reduce((s, l) => s + Number(l[k] ?? 0), 0);
  const taxBuckets = ["A_ITC_REVERSAL", "B_RCM_OUTPUT_SHORTFALL", "C_CREDIT_NOTE", "D_OTHER_LIABILITY"];
  const tax = taxBuckets.includes(bucket) ? sum("tax") : 0;
  const recoverable = ["G_RECOVERABLE", "H_CASH_TRANSFER"].includes(bucket) ? sum("absTax") : 0;
  const contingent = bucket === "F_CONTINGENT" ? sum("absTax") : 0;
  const reavailable = items.every((i) => RCM_TYPES.has(i.exception_type)) ? tax : 0;
  const fys = Array.from(new Set(items.map((i) => financialYear(i.period ?? i.doc_date ?? asOf))));
  const lim = demandLimitation(fys.sort()[0], false);
  const pen = tax > 0 ? potentialPenalty(lim.regime, false, tax) : null;
  const outputs = {
    tax, igst: taxBuckets.includes(bucket) ? sum("igst") : 0, cgst: taxBuckets.includes(bucket) ? sum("cgst") : 0, sgst: taxBuckets.includes(bucket) ? sum("sgst") : 0,
    cess: taxBuckets.includes(bucket) ? sum("cess") : 0, interest: sum("interest"), penalty: pen?.penalty ?? 0, recoverable, contingent, reavailable,
    affectedValue: sum("taxable"), limitation: lim, penaltyBasis: pen?.basis ?? null, lines,
    notes: [
      ...(bucket === "A_ITC_REVERSAL" ? ["Interest computed under Section 50(3) assumes the credit was utilised; reduce if the electronic credit ledger balance never fell below the amount (Rule 88B(3))."] : []),
      ...(reavailable ? ["Reverse charge discharged is available as input tax credit in the same period, subject to Section 16 and the self-invoice under Section 31(3)(f)."] : []),
      ...lim.notes, ...(pen?.notes ?? []),
    ],
  };
  const inputs = { engagementId, bucket, asOf, exceptions: items.map((i) => ({ id: i.id, type: i.exception_type, diff_tax: i.diff_tax, period: i.period, doc_date: i.doc_date })) };
  const hash = createHash("sha256").update(JSON.stringify({ inputs, ENGINE_VERSION })).digest("hex");
  const [snap] = await tx<{ id: string }[]>`insert into public.financial_calculations (organisation_id, engagement_id, calc_type, inputs, outputs, rule_code, engine_version, input_hash, created_by)
    values (${user.orgId}, ${engagementId}, 'observation_impact', ${tx.json(inputs as never)}, ${tx.json(outputs as never)}, ${lim.ruleCode}, ${ENGINE_VERSION}, ${hash}, ${user.id}) returning id`;
  return { snapshotId: snap.id, ...outputs };
}

export async function createObservationFromExceptions(tx: Tx, user: SessionUser, engagementId: string, exceptionIds: string[]): Promise<string> {
  const items = await tx<ExRow[]>`select * from public.reconciliation_exceptions where id = any(${exceptionIds}::uuid[]) and engagement_id = ${engagementId} order by doc_date nulls last, doc_no`;
  if (!items.length) throw new Error("No exceptions selected.");
  if (items.some((i) => (i as unknown as { status: string }).status === "converted")) throw new Error("One or more exceptions already belong to an observation.");
  const first = items[0];
  const types = Array.from(new Set(items.map((i) => i.exception_type)));
  const bucket = bucketFor(first.exception_type);
  const [e] = await tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${engagementId}`;
  const [tpl] = first.control_id ? await tx`select * from public.observation_templates where control_id = ${first.control_id} and is_approved order by created_at limit 1` : [];
  const [ctrl] = first.control_id ? await tx`select cv.corrective_action, cv.law_refs, cv.risk_level from public.control_versions cv where cv.control_id = ${first.control_id} order by version desc limit 1` : [];
  const refs = ctrl ? await tx<{ code: string; provision: string | null; statute: string | null; title: string }[]>`
    select code, provision, statute, title from public.legal_references where code = any(${ctrl.law_refs})` : [];
  const impact = await computeImpact(tx, user, engagementId, items, bucket);
  const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(obs_number), 0) + 1 n from public.audit_observations where engagement_id = ${engagementId}`;
  const sevOrder = ["critical", "high", "medium", "low", "opportunity"];
  const risk = items.map((i) => i.severity).sort((a, b) => sevOrder.indexOf(a) - sevOrder.indexOf(b))[0];
  const title = items.length === 1
    ? `${first.exception_type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}${first.doc_no ? ` — ${first.doc_no}` : ""}`
    : `${first.exception_type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} — ${items.length} documents`;
  const lines = items.slice(0, 25).map((i) => `• ${i.doc_no ?? "—"}${i.doc_date ? ` dated ${fmtDate(i.doc_date)}` : ""}${i.counterparty_name ? ` (${i.counterparty_name})` : ""}: ${i.description}`).join("\n");
  const observationText = items.length === 1 ? first.description
    : `${items.length} exceptions of the type "${types.join(", ").replace(/_/g, " ").toLowerCase()}" were identified from the reconciliation of the records furnished:\n${lines}${items.length > 25 ? `\n… and ${items.length - 25} more (see annexure).` : ""}`;
  const legal = tpl?.legal_framework ?? (refs.length ? refs.map((r) => `• ${r.provision ?? r.code} of the ${r.statute ?? ""} — ${r.title}`).join("\n") : "");
  const quantified = impact.tax > 0 || impact.recoverable > 0 || impact.contingent > 0;
  const implication = quantified
    ? [impact.tax ? `Tax of ₹${formatINR(impact.tax, { decimals: 0 })} (IGST ₹${formatINR(impact.igst, { decimals: 0 })}, CGST ₹${formatINR(impact.cgst, { decimals: 0 })}, SGST ₹${formatINR(impact.sgst, { decimals: 0 })}).` : "",
       impact.interest ? `Indicative interest of ₹${formatINR(impact.interest, { decimals: 0 })} computed to ${fmtDate(todayIso())} under Section 50 at 18% p.a. from the respective due dates.` : "",
       impact.reavailable ? `Credit of ₹${formatINR(impact.reavailable, { decimals: 0 })} is re-available on discharge, so the net cost is principally interest.` : "",
       impact.recoverable ? `Amount recoverable / available: ₹${formatINR(impact.recoverable, { decimals: 0 })}.` : "",
       impact.contingent ? `Contingent exposure of ₹${formatINR(impact.contingent, { decimals: 0 })} pending details.` : "",
       impact.penalty ? `Potential penalty (${impact.penaltyBasis}) of ₹${formatINR(impact.penalty, { decimals: 0 })} is disclosed separately and is subject to legal conditions and professional review.` : "",
       `Demand provision for the period: ${impact.limitation.basis}; notice to be issued by ${fmtDate(impact.limitation.scnBy)}.`].filter(Boolean).join(" ")
    : "To be quantified — the records needed to compute the exposure were not available.";
  const [obs] = await tx<{ id: string }[]>`insert into public.audit_observations (organisation_id, engagement_id, client_id, client_gstin_id, obs_number, module, control_id,
      category, title, observation_text, legal_framework, legal_reference_codes, financial_implication, action_required, preventive_control, risk_grade,
      classification, confidence, impact_bucket, is_quantified, tax_amount, igst, cgst, sgst, cess, itc_reavailable, interest_amount, penalty_amount,
      recoverable_amount, contingent_amount, affected_value, impact_text, interest_from, status, workflow_status, source_exception_ids, calc_snapshot_id, created_by)
    values (${user.orgId}, ${engagementId}, ${e.client_id}, ${first.client_gstin_id}, ${n}, ${first.module}, ${first.control_id},
      ${tpl?.category ?? CATEGORY[first.module] ?? "General"}, ${title}, ${observationText}, ${legal}, ${refs.map((r) => r.code)}, ${implication},
      ${tpl?.action_required ?? ctrl?.corrective_action ?? ""}, ${tpl?.preventive_control ?? ""}, ${risk},
      ${first.classification ?? (risk === "opportunity" ? "potential_opportunity" : "requires_investigation")}, ${items.every((i) => i.classification === "confirmed") ? "high" : "medium"},
      ${quantified ? bucket : bucket === "F_CONTINGENT" ? "F_CONTINGENT" : "NONE"}, ${quantified}, ${paiseToDecimal(impact.tax)}, ${paiseToDecimal(impact.igst)},
      ${paiseToDecimal(impact.cgst)}, ${paiseToDecimal(impact.sgst)}, ${paiseToDecimal(impact.cess)}, ${paiseToDecimal(impact.reavailable)},
      ${paiseToDecimal(impact.interest)}, ${paiseToDecimal(impact.penalty)}, ${paiseToDecimal(impact.recoverable)}, ${paiseToDecimal(impact.contingent)},
      ${paiseToDecimal(Math.abs(impact.affectedValue))}, ${quantified ? null : "To be quantified"}, ${impact.lines.map((l) => l.interestFrom).filter(Boolean).sort()[0] ?? null},
      'draft', 'exception_detected', ${items.map((i) => i.id)}, ${impact.snapshotId}, ${user.id})
    returning id`;
  await tx`update public.financial_calculations set observation_id = ${obs.id} where id = ${impact.snapshotId}`;
  await tx`update public.reconciliation_exceptions set status = 'converted', observation_id = ${obs.id} where id = any(${items.map((i) => i.id)}::uuid[])`;
  const srcIds = Array.from(new Set(items.flatMap((i) => i.source_ids)));
  await tx`insert into public.observation_evidence (observation_id, engagement_id, source_transaction_ids, description, added_by)
    values (${obs.id}, ${engagementId}, ${srcIds}::uuid[], ${`System-linked source records for ${items.length} exception(s)`}, ${user.id})`;
  if (first.control_id) await tx`update public.audit_test_results set status = 'confirmed_observation'
    where engagement_id = ${engagementId} and control_id = ${first.control_id} and status in ('exception_detected','under_investigation','pending_review','in_progress')`;
  return obs.id;
}
