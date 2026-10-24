import "server-only";
import type { Tx } from "@/lib/db";

export interface Coverage {
  applicable: number; tested: number; passed: number; failed: number; investigation: number; awaiting: number; notStarted: number;
  notApplicable: number; testedWithoutWork: number;
  coveragePct: number; exceptionRatePct: number;
  evidence: { required: number; received: number; accepted: number; pct: number };
  observations: { total: number; reviewed: number; unreviewed: number };
  outstanding: { count: number; tax: string };
  conclusion: string;
}

const TESTED = ["passed", "exception_detected", "confirmed_observation", "resolved", "closed", "pending_review", "under_investigation", "pending_client"];

/**
 * Evidence-adjusted coverage. A control counts as tested only when its status shows testing AND
 * work performed or evidence has been recorded against it.
 */
export async function engagementCoverage(tx: Tx, engagementId: string): Promise<Coverage> {
  const rows = await tx<{ status: string; has_work: boolean }[]>`
    select status, (coalesce(length(work_performed), 0) > 0 or cardinality(evidence_document_ids) > 0) has_work
    from public.audit_test_results where engagement_id = ${engagementId}`;
  const c = { applicable: 0, tested: 0, passed: 0, failed: 0, investigation: 0, awaiting: 0, notStarted: 0, notApplicable: 0, testedWithoutWork: 0 };
  for (const r of rows) {
    if (r.status === "not_applicable") { c.notApplicable++; continue; }
    c.applicable++;
    const tested = TESTED.includes(r.status);
    if (tested && !r.has_work) { c.testedWithoutWork++; c.notStarted++; continue; }
    if (tested && !["under_investigation", "pending_client"].includes(r.status)) c.tested++;
    if (r.status === "passed") c.passed++;
    else if (["exception_detected", "confirmed_observation", "resolved", "closed", "pending_review"].includes(r.status)) c.failed++;
    else if (["under_investigation", "pending_client"].includes(r.status)) c.investigation++;
    else if (r.status === "data_awaited") c.awaiting++;
    else c.notStarted++;
  }
  const [ev] = await tx<{ required: number; received: number; accepted: number }[]>`
    select count(*) filter (where status <> 'not_applicable')::int required,
           count(*) filter (where status in ('uploaded','accepted'))::int received,
           count(*) filter (where status = 'accepted')::int accepted
    from public.document_requests where engagement_id = ${engagementId}`;
  const [ob] = await tx<{ total: number; reviewed: number }[]>`
    select count(*)::int total, count(*) filter (where status in ('approved','shared_with_client','client_responded','final','resolved','closed'))::int reviewed
    from public.audit_observations where engagement_id = ${engagementId}`;
  const [out] = await tx<{ count: number; tax: string }[]>`
    select count(*)::int count, coalesce(sum(tax_amount), 0)::text tax from public.audit_observations
    where engagement_id = ${engagementId} and risk_grade in ('critical','high') and status not in ('resolved','closed')`;
  const coveragePct = c.applicable ? Math.round((c.tested / c.applicable) * 1000) / 10 : 0;
  const exceptionRatePct = c.tested ? Math.round((c.failed / c.tested) * 1000) / 10 : 0;
  const evidencePct = ev.required ? Math.round((ev.accepted / ev.required) * 1000) / 10 : 0;
  const unverified = c.applicable - c.tested;
  const conclusion = c.applicable === 0
    ? "No applicable controls have been set up for this engagement yet."
    : `Applicable audit controls tested: ${coveragePct}%. ${unverified ? `${unverified} control${unverified === 1 ? " remains" : "s remain"} unverified` : "All applicable controls have been tested"}` +
      `${c.awaiting ? `, of which ${c.awaiting} await supporting data from the client` : ""}${c.investigation ? `; ${c.investigation} under investigation` : ""}.` +
      ` Exceptions were identified in ${c.failed} of ${c.tested} tested control(s).`;
  return { ...c, coveragePct, exceptionRatePct, evidence: { ...ev, pct: evidencePct },
    observations: { total: ob.total, reviewed: ob.reviewed, unreviewed: ob.total - ob.reviewed }, outstanding: out, conclusion };
}
