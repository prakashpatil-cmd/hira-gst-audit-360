/** Renders a sample report from synthetic data (layout check / regression). Usage: tsx scripts/sample-report.tsx out.pdf */
import fs from "node:fs";
import { renderReportPdf } from "@/lib/reports/pdf";
import { summariseImpact } from "@/lib/impact";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import type { ReportSnapshot, ReportObservation } from "@/lib/reports/snapshot";

const obs = (n: number, title: string, bucket: string, tax: string, risk: string, part: string, extra: Partial<ReportObservation & { itc_reavailable: string; contingent_amount: string; recoverable_amount: string }> = {}) => ({
  id: `obs-${n}`, obs_number: n, title, category: bucket.startsWith("A") ? "ITC Reversal" : bucket.startsWith("B") ? "RCM Default" : "Output Tax", module: bucket.startsWith("A") ? "C" : "D",
  part_label: part, gstin: "27AABCT1234C1ZK", location: null, risk_grade: risk, classification: "confirmed", status: "approved", is_repeat: n === 32,
  observation_text: `Voucher No. SER/2627/${n} dated 18.05.2026 records a payment to an overseas vendor. Integrated tax under reverse charge has not been discharged.\nThe credit is available in the same month, so the net cost is interest provided the position is regularised now.`,
  legal_framework: "• Section 5(3) of the IGST Act, 2017 read with Notification No. 10/2017-Integrated Tax (Rate) — services supplied by a person in a non-taxable territory.\n• Section 31(3)(f) of the CGST Act, 2017 read with Rule 47A — self-invoice within thirty days.\n• Section 50(1) of the CGST Act, 2017 — interest.",
  financial_implication: `Tax of Rs. ${tax}. Indicative interest is computed under Section 50(1).`, root_cause: "No import-of-service determination before payments to overseas vendors.",
  action_required: "1. Raise self-invoices and discharge integrated tax with interest.\n2. Include the items in the consolidated DRC-03.\n3. Scan the expense heads for every foreign payment.",
  preventive_control: "Make an RCM checklist mandatory before overseas payments are released.", impact_label: Number(tax) ? `Rs. ${Number(tax).toLocaleString("en-IN")}` : "To be quantified",
  tax_amount: tax, interest_amount: "1200", penalty_amount: "10000", impact_bucket: bucket, is_quantified: Number(tax) > 0, action_owner: "Finance Head", target_date: "2026-11-15",
  responses: n === 16 ? [{ text: "Management accepts the observation and will reverse the credit in the October 2026 GSTR-3B.", by: "CFO", date: "2026-10-20" }] : [], calc: null,
  ...extra,
});
const list = [
  obs(1, "Credit Notes Raised Without Satisfying the Conditions of Section 34", "C_CREDIT_NOTE", "2021", "medium", "Part A — Bhiwandi"),
  obs(13, "Export Invoices FY 2025-26 Filed Without Shipping Bill Number, Date and Port Code — 91 Invoices", "NONE", "0", "high", "Part A — Bhiwandi", { impact_label: "Rs. 8,52,97,237 turnover affected" }),
  obs(16, "IGST of Rs. 87,70,510 Wrongly Availed Against a NIL-Duty FTWZ Bill of Entry", "A_ITC_REVERSAL", "8770510", "critical", "Part B — Goregaon"),
  obs(17, "Rs. 24,75,430 Lying Unutilised in the West Bengal Electronic Cash Ledger", "H_CASH_TRANSFER", "0", "opportunity", "Part B — Goregaon", { recoverable_amount: "2475430" }),
  obs(31, "Sale of Fixed Assets — Details Not Provided", "F_CONTINGENT", "0", "high", "Part B — Goregaon", { contingent_amount: "425485" }),
  obs(34, "Reverse Charge Not Discharged on Foreign Software Payments — Rs. 30,694", "B_RCM_OUTPUT_SHORTFALL", "30694", "medium", "Part B — Goregaon", { itc_reavailable: "30694" }),
];
const impactRows = list.map((o) => ({ ...o, itc_reavailable: (o as { itc_reavailable?: string }).itc_reavailable ?? "0", contingent_amount: (o as { contingent_amount?: string }).contingent_amount ?? "0",
  recoverable_amount: (o as { recoverable_amount?: string }).recoverable_amount ?? "0", impact_text: Number(o.tax_amount) ? null : o.impact_label, affected_value: null }));
const snap: ReportSnapshot = {
  generatedAt: new Date().toISOString(), firm: DEFAULT_SETTINGS,
  engagement: { code: "HGA-202627-001", title: "GST Health Check", financialYear: "2026-27", periodFrom: "2026-03-01", periodTo: "2026-06-30",
    clientName: "Sample Diagnostics India Private Limited", pan: "AABCT1234C", gstins: ["27AABCT1234C1ZK", "19AABCT1234C1ZI"],
    locations: [{ name: "Bhiwandi", part: "Part A" }, { name: "Goregaon", part: "Part B" }], visits: [{ label: "Bhiwandi", from: "2026-05-28", to: "2026-05-28" }, { label: "Goregaon", from: "2026-07-27", to: "2026-07-29" }],
    scope: "Outward supplies, exports, ITC, RCM, ISD, e-way bill and e-invoice, fixed assets, ledgers.", exclusions: null, auditType: "health_check", partner: "Prakash Patil", manager: null },
  observations: list as ReportObservation[], excludedDrafts: 0, impact: summariseImpact(impactRows as never),
  coverage: { applicable: 120, tested: 113, passed: 80, failed: 33, investigation: 2, awaiting: 5, notStarted: 2, notApplicable: 20, testedWithoutWork: 0, coveragePct: 94.2,
    exceptionRatePct: 29.2, evidence: { required: 25, received: 22, accepted: 20, pct: 80 }, observations: { total: 6, reviewed: 6, unreviewed: 0 }, outstanding: { count: 3, tax: "0" },
    conclusion: "Applicable audit controls tested: 94.2%. 7 controls remain unverified, of which 5 await supporting data from the client. Exceptions were identified in 33 of 113 tested control(s)." },
  actions: [{ priority: 1, title: "Amend Table 6A through Table 9A of GSTR-1 for the 91 export invoices", obs: 13, amount: null, amountLabel: "8,52,97,237 turnover", timeline: "Before 30/11/2026 — statutory cut-off" },
    { priority: 2, title: "Reverse the FTWZ input tax credit and pay interest through DRC-03", obs: 16, amount: "8770510", amountLabel: null, timeline: "Next GSTR-3B" }],
  roadmap: [{ frequency: "Monthly", controls: ["Reconcile the sales register with GSTR-1 and GSTR-3B before filing.", "Run the ICEGATE transmission status report before and after filing GSTR-1."] }],
  content: { managementIntro: "This review covered the Bhiwandi and Goregaon locations for March to June 2026.", recommendations: "Reverse the FTWZ credits in the very next GSTR-3B.\nStart the export cure programme now.",
    bottomLine: "A net cash outflow of approximately Rs. 88,00,384 plus interest.", background: "HIRA Associates carried out a GST Health Check.", methodology: "Records were reconciled document by document.",
    closing: "This report is based on the records made available.", roadmap: "" },
  revisions: [{ version: 1, label: "DRAFT", status: "draft", at: new Date().toISOString(), note: "Initial draft" }],
};
const variants: Record<string, (x: ReportSnapshot) => ReportSnapshot> = {
  full: (x) => x, noObs: (x) => ({ ...x, observations: [] }), noActions: (x) => ({ ...x, actions: [] }), noRoadmap: (x) => ({ ...x, roadmap: [] }),
  oneObs: (x) => ({ ...x, observations: x.observations.slice(0, 1) }),
  twoSamePart: (x) => ({ ...x, observations: x.observations.slice(0, 2) }),
  noParts: (x) => ({ ...x, observations: x.observations.map((o) => ({ ...o, part_label: null })) }),
  threeNoParts: (x) => ({ ...x, observations: x.observations.slice(0, 3).map((o) => ({ ...o, part_label: null })) }),
  obs16only: (x) => ({ ...x, observations: x.observations.filter((o) => o.obs_number === 16) }),
  obs13only: (x) => ({ ...x, observations: x.observations.filter((o) => o.obs_number === 13) }), noVisits: (x) => ({ ...x, engagement: { ...x.engagement, visits: [], locations: [] } }),
};
if (process.argv[2] === "--bisect") {
  for (const [k, f] of Object.entries(variants)) {
    try { await renderReportPdf(f(snap), "DRAFT"); console.log(k, "ok"); } catch (e) { console.log(k, "FAIL", (e as Error).message.slice(0, 60)); }
  }
} else renderReportPdf(snap, (process.argv[3] as "DRAFT") ?? "DRAFT").then((b) => { fs.writeFileSync(process.argv[2] ?? "sample.pdf", b); console.log("bytes", b.length); });
