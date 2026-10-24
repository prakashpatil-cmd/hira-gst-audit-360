"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { run, formObject, zOptStr, zOptDate, zMoney } from "@/lib/actions";
import { storeDocument } from "@/lib/import/service";
import { computeImpact } from "@/lib/observations";
import { ENGINE_VERSION } from "@/lib/rules/statutory";
import type { ActionState } from "@/components/app/action-form";

const RISK = z.enum(["critical", "high", "medium", "low", "opportunity"]);
const BUCKET = z.enum(["A_ITC_REVERSAL", "B_RCM_OUTPUT_SHORTFALL", "C_CREDIT_NOTE", "D_OTHER_LIABILITY", "E_ITC_REAVAILABLE", "F_CONTINGENT", "G_RECOVERABLE", "H_CASH_TRANSFER", "NONE"]);
const CLASS = z.enum(["confirmed", "probable", "requires_investigation", "documentary_deficiency", "potential_opportunity", "not_applicable", "resolved"]);

export async function createObservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("observations.edit");
    const d = z.object({ engagement_id: z.string().uuid(), template_id: zOptStr, title: zOptStr, module: z.string().regex(/^[A-Q]$/).default("B"),
      client_gstin_id: zOptStr }).parse(formObject(fd));
    const id = await withUser(user.id, async (tx) => {
      const [e] = await tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${d.engagement_id}`;
      const [t] = d.template_id ? await tx`select * from public.observation_templates where id = ${d.template_id}` : [null];
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(obs_number), 0) + 1 n from public.audit_observations where engagement_id = ${d.engagement_id}`;
      const [o] = await tx<{ id: string }[]>`insert into public.audit_observations (organisation_id, engagement_id, client_id, client_gstin_id, obs_number, module, control_id,
          category, title, observation_text, legal_framework, legal_reference_codes, action_required, preventive_control, risk_grade, impact_bucket, impact_text, created_by)
        values (${user.orgId}, ${d.engagement_id}, ${e.client_id}, ${d.client_gstin_id}, ${n}, ${t?.module ?? d.module}, ${t?.control_id ?? null},
          ${t?.category ?? "General"}, ${d.title ?? t?.title ?? "New observation"}, ${t?.observation_text ?? ""}, ${t?.legal_framework ?? ""},
          ${t?.legal_reference_codes ?? []}, ${t?.action_required ?? ""}, ${t?.preventive_control ?? ""}, ${t?.risk_grade ?? "medium"}, ${t?.impact_bucket ?? "NONE"},
          'To be quantified', ${user.id}) returning id`;
      return o.id;
    });
    redirect(`/engagements/${d.engagement_id}/observations/${id}`);
  });
}

export async function saveObservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("observations.edit");
    const d = z.object({
      id: z.string().uuid(), engagement_id: z.string().uuid(), title: z.string().trim().min(3), category: z.string().trim().min(2), part_label: zOptStr,
      module: z.string().regex(/^[A-Q]$/), client_gstin_id: zOptStr, location_id: zOptStr, risk_grade: RISK, classification: CLASS, confidence: z.enum(["high", "medium", "low"]),
      observation_text: z.string(), legal_framework: z.string(), financial_implication: z.string(), root_cause: z.string(), action_required: z.string(),
      preventive_control: z.string(), responsible_user_id: zOptStr, action_owner_name: zOptStr, target_date: zOptDate, is_repeat: z.boolean(),
      workflow_status: z.string(),
    }).parse({ ...formObject(fd), is_repeat: fd.get("is_repeat") === "on" });
    await withUser(user.id, async (tx) => {
      const r = await tx`update public.audit_observations set title = ${d.title}, category = ${d.category}, part_label = ${d.part_label}, module = ${d.module},
          client_gstin_id = ${d.client_gstin_id}, location_id = ${d.location_id}, risk_grade = ${d.risk_grade}, classification = ${d.classification},
          confidence = ${d.confidence}, observation_text = ${d.observation_text}, legal_framework = ${d.legal_framework},
          financial_implication = ${d.financial_implication}, root_cause = ${d.root_cause}, action_required = ${d.action_required},
          preventive_control = ${d.preventive_control}, responsible_user_id = ${d.responsible_user_id}, action_owner_name = ${d.action_owner_name},
          target_date = ${d.target_date}, is_repeat = ${d.is_repeat}, workflow_status = ${d.workflow_status},
          status = case when status = 'approved' then 'pending_review' else status end
        where id = ${d.id} and engagement_id = ${d.engagement_id}`;
      if (!r.count) throw new Error("Observation not found.");
    });
    revalidatePath(`/engagements/${d.engagement_id}/observations/${d.id}`);
    return { ok: true, message: "Saved. (Editing an approved observation returns it to review.)" };
  });
}

/** Manual quantification: amounts entered by the auditor are recorded as an immutable calculation snapshot. */
export async function saveImpactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("observations.edit");
    const d = z.object({ id: z.string().uuid(), engagement_id: z.string().uuid(), impact_bucket: BUCKET, igst: zMoney, cgst: zMoney, sgst: zMoney, cess: zMoney,
      itc_reavailable: zMoney, interest_amount: zMoney, penalty_amount: zMoney, recoverable_amount: zMoney, contingent_amount: zMoney,
      affected_value: zMoney, impact_text: zOptStr, basis: z.string().trim().min(5, "Explain the basis of the figures"), recompute: z.boolean() })
      .parse({ ...formObject(fd), recompute: fd.get("recompute") === "1" });
    await withUser(user.id, async (tx) => {
      const [o] = await tx`select source_exception_ids, impact_bucket from public.audit_observations where id = ${d.id}`;
      if (d.recompute) {
        if (!o.source_exception_ids.length) throw new Error("This observation has no linked exceptions to recompute from.");
        const items = await tx`select * from public.reconciliation_exceptions where id = any(${o.source_exception_ids}::uuid[])`;
        const imp = await computeImpact(tx, user, d.engagement_id, items as never, d.impact_bucket);
        await tx`update public.financial_calculations set observation_id = ${d.id} where id = ${imp.snapshotId}`;
        const P = (p: number) => (p / 100).toFixed(2);
        await tx`update public.audit_observations set impact_bucket = ${d.impact_bucket}, tax_amount = ${P(imp.tax)}, igst = ${P(imp.igst)}, cgst = ${P(imp.cgst)},
            sgst = ${P(imp.sgst)}, cess = ${P(imp.cess)}, interest_amount = ${P(imp.interest)}, penalty_amount = ${P(imp.penalty)}, itc_reavailable = ${P(imp.reavailable)},
            recoverable_amount = ${P(imp.recoverable)}, contingent_amount = ${P(imp.contingent)}, is_quantified = ${imp.tax + imp.recoverable + imp.contingent > 0},
            calc_snapshot_id = ${imp.snapshotId}, status = case when status = 'approved' then 'pending_review' else status end where id = ${d.id}`;
        return;
      }
      const tax = (Number(d.igst) + Number(d.cgst) + Number(d.sgst) + Number(d.cess)).toFixed(2);
      const inputs = { manual: true, ...d };
      const outputs = { tax, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess, interest: d.interest_amount, penalty: d.penalty_amount,
        recoverable: d.recoverable_amount, contingent: d.contingent_amount, reavailable: d.itc_reavailable };
      const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
      const [snap] = await tx<{ id: string }[]>`insert into public.financial_calculations (organisation_id, engagement_id, observation_id, calc_type, inputs, outputs, engine_version, input_hash, created_by)
        values (${user.orgId}, ${d.engagement_id}, ${d.id}, 'manual_quantification', ${tx.json(inputs as never)}, ${tx.json(outputs as never)}, ${ENGINE_VERSION}, ${hash}, ${user.id}) returning id`;
      const quantified = Number(tax) + Number(d.recoverable_amount) + Number(d.contingent_amount) > 0;
      await tx`update public.audit_observations set impact_bucket = ${d.impact_bucket}, tax_amount = ${tax}, igst = ${d.igst}, cgst = ${d.cgst}, sgst = ${d.sgst}, cess = ${d.cess},
          itc_reavailable = ${d.itc_reavailable}, interest_amount = ${d.interest_amount}, penalty_amount = ${d.penalty_amount}, recoverable_amount = ${d.recoverable_amount},
          contingent_amount = ${d.contingent_amount}, affected_value = ${d.affected_value}, is_quantified = ${quantified},
          impact_text = ${quantified ? d.impact_text : d.impact_text ?? "To be quantified"}, calc_snapshot_id = ${snap.id},
          status = case when status = 'approved' then 'pending_review' else status end
        where id = ${d.id}`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/observations/${d.id}`);
    return { ok: true, message: "Financial impact recorded with a calculation snapshot." };
  });
}

const TRANSITIONS: Record<string, { from: string[]; to: string; perm: "observations.edit" | "observations.approve" | "observations.review"; lock?: boolean; unlock?: boolean }> = {
  submit: { from: ["draft", "changes_requested"], to: "pending_review", perm: "observations.edit" },
  approve: { from: ["pending_review"], to: "approved", perm: "observations.approve" },
  request_changes: { from: ["pending_review", "approved"], to: "changes_requested", perm: "observations.review" },
  share: { from: ["approved"], to: "shared_with_client", perm: "observations.approve" },
  final: { from: ["approved", "shared_with_client", "client_responded"], to: "final", perm: "observations.approve", lock: true },
  reopen: { from: ["approved", "shared_with_client", "client_responded", "final"], to: "draft", perm: "observations.approve", unlock: true },
  resolve: { from: ["final"], to: "resolved", perm: "observations.edit" },
  close: { from: ["final", "resolved"], to: "closed", perm: "observations.approve" },
};

export async function workflowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser();
    const d = z.object({ id: z.string().uuid(), engagement_id: z.string().uuid(), op: z.enum(Object.keys(TRANSITIONS) as [string, ...string[]]), comment: zOptStr }).parse(formObject(fd));
    const t = TRANSITIONS[d.op];
    if (!can(user, t.perm)) return { error: "Your role cannot perform this step." };
    if ((d.op === "request_changes" || d.op === "reopen") && !d.comment) return { error: "Add a comment explaining the request." };
    await withUser(user.id, async (tx) => {
      const [o] = await tx`select * from public.audit_observations where id = ${d.id} and engagement_id = ${d.engagement_id} for update`;
      if (!o) throw new Error("Observation not found.");
      if (!t.from.includes(o.status)) throw new Error(`Cannot ${d.op.replace("_", " ")} an observation that is ${o.status.replace(/_/g, " ")}.`);
      if (d.op === "approve") {
        if (o.created_by === user.id && user.role !== "super_admin") throw new Error("Segregation of duties: the preparer cannot approve their own observation.");
        if (!o.observation_text.trim() || !o.action_required.trim()) throw new Error("The observation and the action required must be completed before approval.");
        if (!o.legal_framework.trim()) throw new Error("Add the legal framework (or mark ‘Legal Review Required’) before approval.");
        if (o.is_quantified && !o.calc_snapshot_id) throw new Error("Quantified amounts must be supported by a calculation snapshot.");
        const pending = await tx`select code from public.legal_references where code = any(${o.legal_reference_codes}) and approval_status <> 'approved'`;
        if (pending.length && !/legal review required/i.test(o.legal_framework)) {
          throw new Error(`Legal references pending verification: ${pending.map((p) => p.code).join(", ")}. Approve them in the Legal Library or state "Legal Review Required" in the legal framework.`);
        }
      }
      await tx`update public.audit_observations set status = ${t.to},
          locked = ${t.lock ? true : t.unlock ? false : o.locked},
          workflow_status = ${t.to === "approved" ? "confirmed_observation" : t.to === "resolved" ? "resolved" : t.to === "closed" ? "closed" : t.to === "pending_review" ? "pending_review" : o.workflow_status},
          ai_approved_by = case when ${d.op === "approve"} and ai_generated then ${user.id}::uuid else ai_approved_by end
        where id = ${d.id}`;
      await tx`insert into public.review_approvals (organisation_id, engagement_id, entity_type, entity_id, action, comment, actor_id)
        values (${user.orgId}, ${d.engagement_id}, 'observation', ${d.id}, ${d.op === "request_changes" ? "request_changes" : d.op === "approve" ? "approve" : d.op === "reopen" ? "reopen" : d.op === "submit" ? "submit" : "comment"},
                ${d.comment ?? `Moved to ${t.to.replace(/_/g, " ")}`}, ${user.id})`;
    });
    revalidatePath(`/engagements/${d.engagement_id}`, "layout");
    // The button that was pressed disappears with the new status, so confirm on the page itself.
    redirect(`/engagements/${d.engagement_id}/observations/${d.id}?moved=${t.to}`);
  });
}

export async function addEvidenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("observations.edit");
    const d = z.object({ id: z.string().uuid(), engagement_id: z.string().uuid(), description: z.string().trim().min(3) }).parse(formObject(fd));
    await withUser(user.id, async (tx) => {
      const [e] = await tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${d.engagement_id}`;
      const f = fd.get("file");
      const doc = f instanceof File && f.size > 0 ? await storeDocument(tx, user, { clientId: e.client_id, engagementId: d.engagement_id, kind: "evidence",
        fileName: f.name, body: Buffer.from(await f.arrayBuffer()), description: d.description }) : null;
      await tx`insert into public.observation_evidence (observation_id, engagement_id, source_document_id, description, added_by)
        values (${d.id}, ${d.engagement_id}, ${doc?.id ?? null}, ${d.description}, ${user.id})`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/observations/${d.id}`);
    return { ok: true, message: "Evidence added." };
  });
}

export async function responseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser({ allowClient: true });
    const d = z.object({ observation_id: z.string().uuid(), engagement_id: z.string().uuid(), op: z.enum(["add", "approve", "reject"]), response_id: zOptStr,
      response_text: zOptStr, responder_name: zOptStr }).parse(formObject(fd));
    await withUser(user.id, async (tx) => {
      if (d.op === "add") {
        if (!d.response_text) throw new Error("Enter the management response.");
        await tx`insert into public.management_responses (observation_id, engagement_id, response_text, responder_user_id, responder_name)
          values (${d.observation_id}, ${d.engagement_id}, ${d.response_text}, ${user.id}, ${d.responder_name ?? user.fullName})`;
        if (user.isClientUser) await tx`update public.audit_observations set status = 'client_responded' where id = ${d.observation_id} and status = 'shared_with_client'`;
      } else {
        if (!can(user, "observations.approve")) throw new Error("Only a manager can approve responses for the report.");
        await tx`update public.management_responses set status = ${d.op === "approve" ? "approved_for_report" : "rejected"}, reviewed_by = ${user.id}, reviewed_at = now()
          where id = ${d.response_id} and observation_id = ${d.observation_id}`;
      }
    });
    revalidatePath(`/engagements/${d.engagement_id}/observations/${d.observation_id}`);
    revalidatePath("/portal");
    return { ok: true, message: "Response recorded." };
  });
}

export async function addActionItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("actions.manage");
    const d = z.object({ engagement_id: z.string().uuid(), observation_id: zOptStr, title: z.string().trim().min(3), description: zOptStr, owner_user_id: zOptStr,
      owner_name: zOptStr, priority: z.coerce.number().int().min(1).max(5), due_date: zOptDate, statutory_deadline: zOptDate,
      amount: z.preprocess((v) => (v === "" ? null : v), zMoney.nullable()), amount_label: zOptStr, compliance_step: zOptStr }).parse(formObject(fd));
    await withUser(user.id, (tx) => tx`insert into public.corrective_actions (organisation_id, engagement_id, observation_id, title, description, owner_user_id, owner_name,
        priority, due_date, statutory_deadline, amount, amount_label, compliance_step, created_by)
      values (${user.orgId}, ${d.engagement_id}, ${d.observation_id}, ${d.title}, ${d.description}, ${d.owner_user_id}, ${d.owner_name}, ${d.priority}, ${d.due_date},
        ${d.statutory_deadline}, ${d.amount}, ${d.amount_label}, ${d.compliance_step}, ${user.id})`);
    revalidatePath(`/engagements/${d.engagement_id}`, "layout");
    return { ok: true, message: "Corrective action added." };
  });
}

export async function updateActionItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser({ allowClient: true });
    const d = z.object({ id: z.string().uuid(), engagement_id: z.string().uuid(), status: z.enum(["open", "in_progress", "completed", "verified", "cancelled"]),
      completion_note: zOptStr }).parse(formObject(fd));
    if (d.status === "verified" && !can(user, "actions.manage")) return { error: "Only the audit team can verify completion." };
    if (d.status === "completed" && !d.completion_note && !(fd.get("file") instanceof File && (fd.get("file") as File).size > 0)) return { error: "Record completion evidence (note or file)." };
    await withUser(user.id, async (tx) => {
      const [a] = await tx`select c.engagement_id, e.client_id from public.corrective_actions c join public.audit_engagements e on e.id = c.engagement_id where c.id = ${d.id}`;
      if (!a) throw new Error("Not found.");
      const f = fd.get("file");
      const doc = f instanceof File && f.size > 0 ? await storeDocument(tx, user, { clientId: a.client_id, engagementId: user.isClientUser ? null : d.engagement_id,
        kind: user.isClientUser ? "client_upload" : "evidence", fileName: f.name, body: Buffer.from(await f.arrayBuffer()), description: `Completion evidence for action ${d.id}` }) : null;
      await tx`update public.corrective_actions set status = ${d.status}, completion_note = coalesce(${d.completion_note}, completion_note),
          completion_document_ids = case when ${doc?.id ?? null}::uuid is null then completion_document_ids else completion_document_ids || ${doc?.id ?? null}::uuid end,
          completed_at = case when ${d.status} = 'completed' then now() else completed_at end,
          verified_by = case when ${d.status} = 'verified' then ${user.id}::uuid else verified_by end,
          verified_at = case when ${d.status} = 'verified' then now() else verified_at end
        where id = ${d.id}`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/actions`);
    revalidatePath("/actions");
    revalidatePath("/portal");
    return { ok: true, message: "Action updated." };
  });
}
