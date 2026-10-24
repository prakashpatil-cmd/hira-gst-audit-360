import "server-only";
import type { Tx } from "@/lib/db";

export const STAGES = [
  { key: "planning", label: "Planning", n: 1 },
  { key: "data_collection", label: "Data collection", n: 2 },
  { key: "reconciliation", label: "Reconciliation", n: 3 },
  { key: "drafting", label: "Observation drafting", n: 4 },
  { key: "internal_review", label: "Internal review", n: 5 },
  { key: "client_discussion", label: "Client discussion", n: 6 },
  { key: "finalisation", label: "Finalisation", n: 7 },
  { key: "follow_up", label: "Post-audit follow-up", n: 8 },
  { key: "closed", label: "Closed", n: 9 },
] as const;

export const MODULES: Record<string, string> = {
  A: "Registration & general compliance", B: "Outward supply & GST liability", C: "Input tax credit", D: "Reverse charge",
  E: "ISD & cross charge", F: "E-invoice", G: "E-way bill", H: "Exports, LUT & ICEGATE", I: "SEZ, FTWZ & deemed exports",
  J: "Imports & Customs", K: "Job work & manufacturing", L: "Fixed assets & capital goods", M: "GST ledgers & cash flow",
  N: "Annual returns", O: "Interest, penalty & limitation", P: "Notices & litigation", Q: "Specialised compliance",
};

interface ClientProfile {
  is_exporter: boolean; is_importer: boolean; supplies_to_sez: boolean; has_job_work: boolean; isd_applicable: boolean;
  has_related_party_txns: boolean; einvoice_applicable: boolean; eway_applicable: boolean; is_merchant_exporter: boolean; has_overseas_txns: boolean;
}

/** Taxpayer classes the client falls into (matched against control_versions.taxpayer_classes). */
export function classesOf(c: ClientProfile, gstinCount: number): Set<string> {
  const s = new Set<string>(["manufacturer"]);
  if (c.is_exporter || c.is_merchant_exporter) s.add("exporter");
  if (c.is_importer) s.add("importer");
  if (c.supplies_to_sez) s.add("sez_supplier");
  if (c.isd_applicable) s.add("isd");
  if (c.has_job_work) s.add("job_work");
  if (c.has_related_party_txns || c.has_overseas_txns) s.add("related_party");
  if (gstinCount > 1) s.add("multi_gstin");
  return s;
}

const REQUESTS: { title: string; dataset: string | null; category: string; when?: (c: ClientProfile) => boolean; priority?: "high" | "normal" }[] = [
  { title: "Sales register with invoice-wise tax, HSN and place of supply", dataset: "sales_register", category: "Accounting", priority: "high" },
  { title: "Purchase register with ITC claimed and GSTR-3B claim period", dataset: "purchase_register", category: "Accounting", priority: "high" },
  { title: "Trial balance (opening, transactions, closing)", dataset: "trial_balance", category: "Accounting", priority: "high" },
  { title: "General ledger / day book for expense heads", dataset: "general_ledger", category: "Accounting" },
  { title: "Fixed asset register with additions, disposals and ITC availed", dataset: "fixed_asset_register", category: "Accounting" },
  { title: "Credit and debit note register with original invoice linkage", dataset: null, category: "Accounting" },
  { title: "Customer and vendor masters with GSTIN", dataset: "vendor_master", category: "Accounting" },
  { title: "GSTR-1 (invoice-level download / JSON) for each registration", dataset: "gstr1", category: "GST returns", priority: "high" },
  { title: "GSTR-3B (table-wise) for each registration", dataset: "gstr3b", category: "GST returns", priority: "high" },
  { title: "GSTR-2B for each month of the audit period", dataset: "gstr2b", category: "GST returns", priority: "high" },
  { title: "Electronic cash ledger, credit ledger and liability register", dataset: "electronic_cash_ledger", category: "GST portal" },
  { title: "Electronic Credit Reversal and Re-claimed Statement", dataset: "ecrrs", category: "GST portal" },
  { title: "RCM liability / ITC statement and self-invoices", dataset: "rcm_statement", category: "GST portal" },
  { title: "E-invoice (IRN) register including cancelled IRNs", dataset: "einvoice_register", category: "E-invoice", when: (c) => c.einvoice_applicable },
  { title: "E-way bill register (generated, cancelled and discarded)", dataset: "eway_bill_register", category: "E-way bill", when: (c) => c.eway_applicable },
  { title: "Shipping bills with LEO, EGM and ICEGATE status", dataset: "shipping_bills", category: "Exports", when: (c) => c.is_exporter || c.is_merchant_exporter, priority: "high" },
  { title: "LUT acknowledgement (ARN) for each financial year", dataset: "lut", category: "Exports", when: (c) => c.is_exporter },
  { title: "Bank realisation certificates / FIRC for exports of services", dataset: null, category: "Exports", when: (c) => c.is_exporter },
  { title: "Bills of entry and customs duty payment records", dataset: "bills_of_entry", category: "Imports", when: (c) => c.is_importer, priority: "high" },
  { title: "SEZ endorsements and LOA of SEZ customers", dataset: "sez_endorsements", category: "SEZ", when: (c) => c.supplies_to_sez },
  { title: "ITC-04 and job-work challan register", dataset: "itc04", category: "Job work", when: (c) => c.has_job_work },
  { title: "GSTR-6 and ISD distribution workings", dataset: "gstr6", category: "ISD", when: (c) => c.isd_applicable },
  { title: "Inter-company agreements, cross-charge and reimbursement workings", dataset: null, category: "Related party", when: (c) => c.has_related_party_txns || c.has_overseas_txns },
  { title: "Foreign remittances (Form 15CA/CB) and overseas vendor invoices", dataset: "bank_payments", category: "RCM", when: (c) => c.has_overseas_txns || c.is_importer },
  { title: "GSTR-9 / GSTR-9C for the latest completed financial year", dataset: "gstr9", category: "Annual return" },
  { title: "GST notices, orders and replies received in the period", dataset: null, category: "Litigation" },
  { title: "DRC-03 payments and GST challans", dataset: "drc03", category: "Payments" },
];

/**
 * Pins approved rule versions and current control versions to the engagement, creates the control
 * checklist with applicability, and generates the document request list. Idempotent.
 */
export async function setupEngagementProgramme(tx: Tx, engagementId: string, actorId: string) {
  const [e] = await tx<{ id: string; organisation_id: string; client_id: string; period_from: string; period_to: string; data_request_date: string | null }[]>`
    select id, organisation_id, client_id, period_from, period_to, data_request_date from public.audit_engagements where id = ${engagementId}`;
  const [c] = await tx<ClientProfile[]>`select * from public.clients where id = ${e.client_id}`;
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.engagement_gstins where engagement_id = ${engagementId}`;
  const classes = classesOf(c, n);

  await tx`insert into public.engagement_rule_pins (engagement_id, rule_definition_id)
    select ${engagementId}, r.id from public.rule_definitions r
    where r.status in ('approved','pending_approval') and r.version = (select max(version) from public.rule_definitions x where x.rule_code = r.rule_code and x.status in ('approved','pending_approval'))
    on conflict do nothing`;

  const versions = await tx<{ id: string; control_id: string; taxpayer_classes: string[]; effective_from: string; effective_to: string | null }[]>`
    select distinct on (cv.control_id) cv.id, cv.control_id, cv.taxpayer_classes, cv.effective_from, cv.effective_to
    from public.control_versions cv join public.audit_controls ac on ac.id = cv.control_id and ac.is_active
    where cv.status in ('approved','pending_approval') order by cv.control_id, cv.version desc`;
  for (const v of versions) {
    await tx`insert into public.engagement_rule_pins (engagement_id, control_version_id) values (${engagementId}, ${v.id}) on conflict do nothing`;
    const inForce = v.effective_from <= e.period_to && (!v.effective_to || v.effective_to >= e.period_from);
    const applies = inForce && (v.taxpayer_classes.length === 0 || v.taxpayer_classes.some((t) => classes.has(t)));
    const note = !inForce ? "Provision not in force during the audit period" : applies ? null : `Not applicable to the client profile (${v.taxpayer_classes.join(", ")})`;
    await tx`insert into public.audit_test_results (organisation_id, engagement_id, control_id, control_version_id, status, applicability_note)
      values (${e.organisation_id}, ${engagementId}, ${v.control_id}, ${v.id}, ${applies ? "not_started" : "not_applicable"}, ${note})
      on conflict (engagement_id, control_id) where client_gstin_id is null do nothing`;
  }

  const [{ existing }] = await tx<{ existing: number }[]>`select count(*)::int existing from public.document_requests where engagement_id = ${engagementId}`;
  if (existing === 0) {
    const due = e.data_request_date ? addDays(e.data_request_date, 7) : null;
    for (const r of REQUESTS.filter((r) => !r.when || r.when(c))) {
      await tx`insert into public.document_requests (organisation_id, engagement_id, title, category, dataset_type, priority, due_date, created_by)
        values (${e.organisation_id}, ${engagementId}, ${r.title}, ${r.category}, ${r.dataset}, ${r.priority ?? "normal"}, ${due}, ${actorId})`;
    }
  }
  await tx`update public.audit_engagements set rule_snapshot_at = coalesce(rule_snapshot_at, now()) where id = ${engagementId}`;
  return { controls: versions.length, classes: Array.from(classes) };
}

function addDays(iso: string, d: number) {
  const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10);
}
