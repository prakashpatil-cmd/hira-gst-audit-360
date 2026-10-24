import { createHash } from "node:crypto";
import type { Tx } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { FirmSettings } from "@/lib/settings-defaults";
import { summariseImpact, type ImpactObs, type ImpactSummary } from "@/lib/impact";
import { engagementCoverage, type Coverage } from "@/lib/coverage";
import { MODULES } from "@/lib/engagements";
import { fmtDate, todayIso } from "@/lib/gst/dates";
import { formatINR, toPaise } from "@/lib/gst/money";

/** Report states whose observations may appear in a report (approved findings only). */
export const REPORTABLE = ["approved", "shared_with_client", "client_responded", "final", "resolved", "closed"];

export interface ReportObservation {
  id: string; obs_number: number; title: string; category: string; module: string | null; part_label: string | null; gstin: string | null; location: string | null;
  risk_grade: string; classification: string; status: string; is_repeat: boolean; observation_text: string; legal_framework: string; financial_implication: string;
  root_cause: string; action_required: string; preventive_control: string; impact_label: string; tax_amount: string; interest_amount: string; penalty_amount: string;
  impact_bucket: string | null; is_quantified: boolean; action_owner: string | null; target_date: string | null;
  responses: { text: string; by: string | null; date: string }[];
  calc: { id: string; hash: string; engine: string; created_at: string } | null;
}

export interface ReportContent {
  managementIntro?: string; recommendations?: string; bottomLine?: string; background?: string; methodology?: string; closing?: string; roadmap?: string;
}

export interface ReportSnapshot {
  generatedAt: string;
  firm: FirmSettings;
  engagement: {
    code: string; title: string; financialYear: string; periodFrom: string; periodTo: string; clientName: string; pan: string; gstins: string[];
    locations: { name: string; part: string | null }[]; visits: { label: string; from: string; to: string }[]; scope: string | null; exclusions: string | null;
    auditType: string; partner: string | null; manager: string | null;
  };
  observations: ReportObservation[];
  excludedDrafts: number;
  impact: ImpactSummary;
  coverage: Coverage;
  actions: { priority: number; title: string; obs: number | null; amount: string | null; amountLabel: string | null; timeline: string }[];
  roadmap: { frequency: string; controls: string[] }[];
  content: Required<ReportContent>;
  revisions: { version: number; label: string; status: string; at: string | null; note: string | null }[];
}

export function impactLabel(o: { tax_amount: string; contingent_amount: string; recoverable_amount: string; affected_value: string | null; impact_text: string | null; is_quantified: boolean }) {
  const R = (v: string) => `Rs. ${formatINR(toPaise(v), { decimals: 0 })}`;
  if (Number(o.tax_amount)) return R(o.tax_amount);
  if (Number(o.contingent_amount)) return `${R(o.contingent_amount)} (contingent)`;
  if (Number(o.recoverable_amount)) return `${R(o.recoverable_amount)} recoverable`;
  if (o.impact_text) return o.impact_text;
  if (Number(o.affected_value ?? 0)) return `${R(o.affected_value!)} value affected`;
  return "To be quantified";
}

const ROADMAP: Record<string, { monthly?: string; quarterly?: string; annual?: string }> = {
  B: { monthly: "Reconcile the sales register with GSTR-1 and GSTR-3B before filing; investigate every difference above the tolerance." },
  C: { monthly: "Match the purchase register with GSTR-2B / IMS invoice by invoice; reverse ineligible and unsupported credit in the same return.", annual: "Confirm the Section 16(4) cut-off position before 30 November." },
  D: { monthly: "Screen foreign payments and notified-service expense heads for reverse charge before payments are released; raise self-invoices within 30 days." },
  E: { quarterly: "Review common-service invoices for correct routing through the ISD and reconcile distributed credit with recipient books." },
  F: { monthly: "Run the IRN register against GSTR-1; no invoice above the threshold leaves without an IRN." },
  G: { monthly: "Reconcile e-way bills (including cancelled and discarded) with dispatches; verify tax-head mapping in the e-way bill master." },
  H: { monthly: "Run the ICEGATE transmission status report before and after filing GSTR-1; treat failures as filing exceptions.", annual: "Renew the LUT before 31 March and amend Table 6A particulars before 30 November." },
  I: { quarterly: "Verify SEZ endorsements and FTWZ documentation before zero-rating or availing credit." },
  J: { monthly: "Match bills of entry with the purchase register and GSTR-2B (IMPG); never avail credit on nil-duty or warehoused bills of entry." },
  K: { quarterly: "Age goods with job workers and file ITC-04 on time." },
  L: { quarterly: "Review fixed-asset disposals and transfers for Section 18(6) tax and invoices." },
  M: { monthly: "Review electronic cash and credit ledgers; use PMT-09 for idle balances and reconcile ECRRS." },
  N: { annual: "Prepare GSTR-9/9C reconciliations from the monthly packs; resolve differences before filing." },
  O: { quarterly: "Track interest on delayed payments and limitation dates for open issues." },
  P: { monthly: "Maintain a notice register with reply and hearing dates; link each notice to the underlying issue." },
};

export async function buildReportSnapshot(tx: Tx, engagementId: string, content: ReportContent, versions: ReportSnapshot["revisions"]): Promise<{ snapshot: ReportSnapshot; hash: string }> {
  const [e] = await tx`select e.*, c.legal_name, c.pan, p.full_name partner, m.full_name manager from public.audit_engagements e join public.clients c on c.id = e.client_id
    left join public.users p on p.id = e.engagement_partner_id left join public.users m on m.id = e.reviewing_manager_id where e.id = ${engagementId}`;
  const firm = await getSettings(e.organisation_id);
  const gstins = await tx<{ gstin: string }[]>`select g.gstin from public.engagement_gstins eg join public.client_gstins g on g.id = eg.client_gstin_id where eg.engagement_id = ${engagementId} order by g.gstin`;
  const locations = await tx<{ name: string; part: string | null }[]>`select l.name, el.part_label part from public.engagement_locations el join public.business_locations l on l.id = el.location_id
    where el.engagement_id = ${engagementId} order by l.name`;
  const rows = await tx`select o.*, g.gstin, l.name location from public.audit_observations o left join public.client_gstins g on g.id = o.client_gstin_id
    left join public.business_locations l on l.id = o.location_id where o.engagement_id = ${engagementId} and o.status = any(${REPORTABLE}) order by o.obs_number`;
  const [{ drafts }] = await tx<{ drafts: number }[]>`select count(*)::int drafts from public.audit_observations where engagement_id = ${engagementId} and not (status = any(${REPORTABLE}))`;
  const ids = rows.map((r) => r.id as string);
  const responses = ids.length ? await tx`select observation_id, response_text, responder_name, response_date from public.management_responses
    where observation_id = any(${ids}::uuid[]) and status = 'approved_for_report' order by created_at` : [];
  const calcs = ids.length ? await tx`select id, input_hash, engine_version, created_at from public.financial_calculations where id = any(${rows.map((r) => r.calc_snapshot_id).filter(Boolean)}::uuid[])` : [];
  const calcMap = new Map(calcs.map((c) => [c.id, c]));
  const observations: ReportObservation[] = rows.map((o) => ({
    id: o.id, obs_number: o.obs_number, title: o.title, category: o.category, module: o.module, part_label: o.part_label, gstin: o.gstin, location: o.location,
    risk_grade: o.risk_grade, classification: o.classification, status: o.status, is_repeat: o.is_repeat, observation_text: o.observation_text, legal_framework: o.legal_framework,
    financial_implication: o.financial_implication, root_cause: o.root_cause, action_required: o.action_required, preventive_control: o.preventive_control,
    impact_label: impactLabel(o as never), tax_amount: o.tax_amount, interest_amount: o.interest_amount, penalty_amount: o.penalty_amount, impact_bucket: o.impact_bucket,
    is_quantified: o.is_quantified, action_owner: o.action_owner_name, target_date: o.target_date,
    responses: responses.filter((r) => r.observation_id === o.id).map((r) => ({ text: r.response_text, by: r.responder_name, date: r.response_date })),
    calc: o.calc_snapshot_id && calcMap.get(o.calc_snapshot_id) ? { id: o.calc_snapshot_id, hash: calcMap.get(o.calc_snapshot_id)!.input_hash, engine: calcMap.get(o.calc_snapshot_id)!.engine_version,
      created_at: new Date(calcMap.get(o.calc_snapshot_id)!.created_at).toISOString() } : null,
  }));
  const impact = summariseImpact(rows as unknown as ImpactObs[]);
  const coverage = await engagementCoverage(tx, engagementId);
  const actionRows = ids.length ? await tx`select a.*, o.obs_number from public.corrective_actions a left join public.audit_observations o on o.id = a.observation_id
    where a.engagement_id = ${engagementId} and (a.observation_id is null or a.observation_id = any(${ids}::uuid[])) and a.status <> 'cancelled'
    order by a.statutory_deadline nulls last, a.priority, a.due_date nulls last` : [];
  const actions = actionRows.map((a, i) => ({ priority: i + 1, title: a.title, obs: a.obs_number, amount: a.amount, amountLabel: a.amount_label,
    timeline: a.statutory_deadline ? `Before ${fmtDate(a.statutory_deadline)} — statutory cut-off` : a.due_date ? `By ${fmtDate(a.due_date)}` : "To be agreed" }));
  const mods = Array.from(new Set(observations.map((o) => o.module).filter(Boolean))) as string[];
  const pick = (f: "monthly" | "quarterly" | "annual") => mods.map((m) => ROADMAP[m]?.[f]).filter(Boolean) as string[];
  const roadmap = [{ frequency: "Monthly", controls: pick("monthly") }, { frequency: "Quarterly", controls: pick("quarterly") }, { frequency: "Annual", controls: pick("annual") }]
    .filter((r) => r.controls.length);

  const client = e.legal_name as string;
  const areas = Array.from(new Set(observations.map((o) => o.module).filter(Boolean))).map((m) => MODULES[m as string].toLowerCase());
  const totalR = formatINR(impact.totalTaxPayable, { decimals: 0 });
  const netR = formatINR(impact.netCashBeforeInterest, { decimals: 0 });
  const defaults: Required<ReportContent> = {
    managementIntro: `This review covered ${gstins.length} GST registration(s) of ${client} for the period ${fmtDate(e.period_from)} to ${fmtDate(e.period_to)}. ` +
      `It examined ${areas.length ? areas.join(", ") : "the areas set out in the scope"} and the periodic reconciliations. ${observations.length} observation(s) have been raised. The quantified financial impact is set out below.`,
    recommendations: actions.slice(0, 6).map((a) => `${a.title}${a.obs ? ` (Obs. ${a.obs})` : ""}.`).join("\n"),
    bottomLine: impact.totalTaxPayable
      ? `A gross quantified tax liability of approximately Rs. ${totalR} has been identified, of which Rs. ${netR} is the net cash outflow before interest after credit that becomes re-available.` +
        (impact.subtotal.G + impact.subtotal.H ? ` Against this, Rs. ${formatINR(impact.subtotal.G + impact.subtotal.H, { decimals: 0 })} is recoverable or available for transfer in the company's favour.` : "") +
        (impact.unquantified.length ? ` ${impact.unquantified.length} observation(s) remain unquantified pending records and are not included in these figures.` : "")
      : "No quantified tax liability has been identified in the approved observations; the observations relate to procedure, documentation or recoverable amounts.",
    background: `${firm.brand.firmName} carried out a GST Health Check for ${client} covering the period ${fmtDate(e.period_from)} to ${fmtDate(e.period_to)}` +
      `${(e.audit_visits as { label: string; from: string; to: string }[]).length ? `, through visits at ${(e.audit_visits as { label: string; from: string; to: string }[]).map((v) => `${v.label} (${fmtDate(v.from)}${v.to && v.to !== v.from ? ` to ${fmtDate(v.to)}` : ""})`).join(" and ")}` : ""}` +
      `, with the object of identifying compliance gaps, quantifying the tax exposure and setting out precise corrective action. Each observation is supported by the underlying voucher, document or portal record.` +
      (e.scope ? `\n\nScope: ${e.scope}` : "") + (e.exclusions ? `\n\nExclusions and data limitations: ${e.exclusions}` : ""),
    methodology: `Records furnished by the company were imported with row-level lineage and validated for GSTIN, dates, tax arithmetic and duplicates. ` +
      `Books, GST returns, e-invoice and e-way bill data, customs records and electronic ledgers were reconciled document by document using deterministic matching with a rounding tolerance of Rs. ${e.tolerance_amount} per document. ` +
      `Exceptions were investigated and only those confirmed or reasonably supported were raised as observations, each reviewed and approved by a manager. ` +
      `Tax amounts are indicative and based on the records made available; interest is computed under Section 50 at the notified rate to the computation date, and potential penalties are shown separately and are subject to legal conditions. Where an amount is shown as "to be quantified", the exposure exists but the data needed to compute it was not available.\n\n` +
      `Risk grades: Critical — significant or urgent exposure requiring immediate escalation. High — material or legally significant exposure, time-barred items or matters attracting extended limitation. Medium — quantifiable exposure within the normal period, or a control weakness requiring correction. Low — documentary or procedural defect with limited financial consequence. Opportunity — potential refund, recovery or working-capital improvement.`,
    closing: `This report is based on the records, vouchers, returns and portal data made available to us during the review and on the explanations furnished by the management. Where a record was called for and not provided, the observation records that fact and the exposure has been left to be quantified.\n\n` +
      `The amounts stated are indicative. Each working should be confirmed by the company before the liability is discharged.\n\n${coverage.conclusion}`,
    roadmap: "",
  };
  const merged = { ...defaults, ...Object.fromEntries(Object.entries(content).filter(([, v]) => typeof v === "string" && v.trim())) } as Required<ReportContent>;
  const snapshot: ReportSnapshot = {
    generatedAt: new Date().toISOString(), firm,
    engagement: { code: e.engagement_code, title: e.title, financialYear: e.financial_year, periodFrom: e.period_from, periodTo: e.period_to, clientName: client, pan: e.pan,
      gstins: gstins.map((g) => g.gstin), locations, visits: e.audit_visits, scope: e.scope, exclusions: e.exclusions, auditType: e.audit_type, partner: e.partner, manager: e.manager },
    observations, excludedDrafts: drafts, impact, coverage, actions, roadmap, content: merged, revisions: versions,
  };
  void todayIso;
  const hash = createHash("sha256").update(JSON.stringify({ ...snapshot, generatedAt: undefined })).digest("hex");
  return { snapshot, hash };
}
