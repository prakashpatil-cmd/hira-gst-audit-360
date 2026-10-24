"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate } from "@/lib/actions";
import { storeDocument } from "@/lib/import/service";
import type { ActionState } from "@/components/app/action-form";

// ---------------- Document requests ----------------
export async function addRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("requests.manage");
    const d = z.object({ engagement_id: z.string().uuid(), title: z.string().trim().min(3), description: zOptStr, category: zOptStr, dataset_type: zOptStr,
      priority: z.enum(["high", "normal", "low"]), due_date: zOptDate, assigned_contact: zOptStr }).parse(formObject(fd));
    await withUser(user.id, (tx) => tx`insert into public.document_requests (organisation_id, engagement_id, title, description, category, dataset_type, priority, due_date, assigned_contact, created_by)
      values (${user.orgId}, ${d.engagement_id}, ${d.title}, ${d.description}, ${d.category}, ${d.dataset_type}, ${d.priority}, ${d.due_date}, ${d.assigned_contact}, ${user.id})`);
    revalidatePath(`/engagements/${d.engagement_id}/requests`);
    return { ok: true, message: "Request added." };
  });
}

export async function updateRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser({ allowClient: true });
    const d = z.object({ id: z.string().uuid(), engagement_id: z.string().uuid(), op: z.enum(["accept", "reject", "not_applicable", "reopen", "remind", "upload"]),
      review_comment: zOptStr }).parse(formObject(fd));
    if (user.isClientUser && d.op !== "upload") return { error: "Not permitted." };
    await withUser(user.id, async (tx) => {
      if (d.op === "upload") {
        const f = fd.get("file");
        if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file.");
        const [e] = await tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${d.engagement_id}`;
        const doc = await storeDocument(tx, user, { clientId: e.client_id, engagementId: user.isClientUser ? null : d.engagement_id,
          kind: user.isClientUser ? "client_upload" : "evidence", fileName: f.name, body: Buffer.from(await f.arrayBuffer()), description: `Response to request ${d.id}` });
        await tx`update public.document_requests set status = 'uploaded', document_ids = document_ids || ${doc.id}::uuid where id = ${d.id}`;
        return;
      }
      const status = { accept: "accepted", reject: "rejected", not_applicable: "not_applicable", reopen: "requested" }[d.op as "accept"];
      if (d.op === "remind") await tx`update public.document_requests set reminder_count = reminder_count + 1, last_reminder_at = now() where id = ${d.id}`;
      else await tx`update public.document_requests set status = ${status}, review_comment = ${d.review_comment} where id = ${d.id}`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/requests`);
    revalidatePath("/portal");
    return { ok: true, message: d.op === "remind" ? "Reminder recorded. (No email transport is configured; share the portal link with the client contact.)" : "Updated." };
  });
}

// ---------------- Control checklist ----------------
export async function updateTestResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("checklist.edit");
    const d = z.object({ engagement_id: z.string().uuid(), control_id: z.string(),
      status: z.enum(["not_started", "data_awaited", "in_progress", "passed", "exception_detected", "under_investigation", "pending_client", "pending_review",
        "confirmed_observation", "resolved", "closed", "not_applicable"]),
      work_performed: zOptStr, conclusion: zOptStr, applicability_note: zOptStr, assigned_to: zOptStr, reviewed: z.boolean().optional() }).parse({ ...formObject(fd), reviewed: fd.get("reviewed") === "on" });
    const tested = ["passed", "exception_detected", "confirmed_observation", "resolved", "closed", "pending_review"].includes(d.status);
    if (tested && !d.work_performed && fd.getAll("evidence").every((f) => !(f instanceof File) || f.size === 0)) {
      const [{ has }] = await withUser(user.id, (tx) => tx<{ has: boolean }[]>`select (coalesce(length(work_performed),0) > 0 or cardinality(evidence_document_ids) > 0) has
        from public.audit_test_results where engagement_id = ${d.engagement_id} and control_id = ${d.control_id} and client_gstin_id is null`);
      if (!has) return { error: "Record the work performed or attach evidence before marking the control as tested." };
    }
    if (d.status === "not_applicable" && !d.applicability_note) return { error: "Give the reason the control is not applicable." };
    if (d.reviewed && !["super_admin", "audit_manager"].includes(user.role)) return { error: "Only a manager can sign off the review." };
    await withUser(user.id, async (tx) => {
      const [e] = await tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${d.engagement_id}`;
      const ids: string[] = [];
      for (const f of fd.getAll("evidence")) {
        if (f instanceof File && f.size > 0) ids.push((await storeDocument(tx, user, { clientId: e.client_id, engagementId: d.engagement_id, kind: "evidence",
          fileName: f.name, body: Buffer.from(await f.arrayBuffer()), description: `Evidence for control ${d.control_id}` })).id);
      }
      await tx`update public.audit_test_results set status = ${d.status}, work_performed = coalesce(${d.work_performed}, work_performed),
          conclusion = coalesce(${d.conclusion}, conclusion), applicability_note = ${d.applicability_note}, assigned_to = ${d.assigned_to},
          evidence_document_ids = evidence_document_ids || ${ids}::uuid[],
          tested_by = case when ${tested} then ${user.id}::uuid else tested_by end, tested_at = case when ${tested} then now() else tested_at end,
          reviewed_by = case when ${!!d.reviewed} then ${user.id}::uuid else reviewed_by end, reviewed_at = case when ${!!d.reviewed} then now() else reviewed_at end
        where engagement_id = ${d.engagement_id} and control_id = ${d.control_id} and client_gstin_id is null`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/checklist`);
    return { ok: true, message: "Working paper saved." };
  });
}
