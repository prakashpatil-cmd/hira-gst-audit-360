"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr } from "@/lib/actions";
import { queueReconWithJob, RECON_TYPES, type ReconType } from "@/lib/recon/runner";
import { kickJob } from "@/lib/jobs/kick";
import { logAction } from "@/lib/audit-log";
import type { ActionState } from "@/components/app/action-form";
import { createObservationFromExceptions } from "@/lib/observations";
import { can } from "@/lib/auth/permissions";

export async function runReconAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("recon.run");
    const d = z.object({ engagement_id: z.string().uuid(), recon_type: z.string(), as_of: zOptStr, tolerance: zOptStr }).parse(formObject(fd));
    const types = (d.recon_type === "ALL" ? Object.keys(RECON_TYPES) : [d.recon_type]) as ReconType[];
    for (const t of types) {
      const params: Record<string, unknown> = {};
      if (d.as_of) params.asOf = d.as_of;
      if (d.tolerance) params.tolerance = d.tolerance;
      const { jobId } = await queueReconWithJob(user, d.engagement_id, t, params);
      await kickJob(jobId);
    }
    revalidatePath(`/engagements/${d.engagement_id}/reconciliation`);
    return { ok: true, message: `${types.length} reconciliation(s) started.` };
  });
}

/** Manual reconciliation decision on a match (approve as reconciled, with a note). */
export async function approveMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("recon.run");
    const d = z.object({ engagement_id: z.string().uuid(), match_id: z.string().uuid(), note: z.string().trim().min(3, "Give the reason") }).parse(formObject(fd));
    await withUser(user.id, async (tx) => {
      await tx`update public.reconciliation_matches set is_manual = true, approved_by = ${user.id}, approved_at = now(), note = ${d.note} where id = ${d.match_id}`;
      await tx`update public.reconciliation_exceptions set status = 'explained', resolution_note = ${d.note}, resolved_by = ${user.id}, resolved_at = now()
        where match_id = ${d.match_id} and status in ('open','under_investigation')`;
      await tx`insert into public.review_approvals (organisation_id, engagement_id, entity_type, entity_id, action, comment, actor_id)
        values (${user.orgId}, ${d.engagement_id}, 'reconciliation_match', ${d.match_id}, 'approve', ${d.note}, ${user.id})`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/reconciliation`, "layout");
    return { ok: true, message: "Manual reconciliation recorded." };
  });
}

export async function triageExceptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("recon.run");
    if (fd.get("op") === "observation") {
      const engagementId = z.string().uuid().parse(fd.get("engagement_id"));
      const ids = z.array(z.string().uuid()).min(1, "Select at least one exception").parse(fd.getAll("ids[]"));
      if (!can(user, "observations.edit")) return { error: "Your role cannot draft observations." };
      const obsId = await withUser(user.id, (tx) => createObservationFromExceptions(tx, user, engagementId, ids));
      redirect(`/engagements/${engagementId}/observations/${obsId}`);
    }
    const d = z.object({ engagement_id: z.string().uuid(), ids: z.array(z.string().uuid()).min(1),
      status: z.enum(["open", "under_investigation", "explained", "not_an_issue"]).optional(),
      classification: z.enum(["confirmed", "probable", "requires_investigation", "documentary_deficiency", "potential_opportunity", "not_applicable", "resolved"]).optional(),
      assigned_to: zOptStr, resolution_note: zOptStr }).parse(formObject(fd));
    if ((d.status === "explained" || d.status === "not_an_issue") && !d.resolution_note) return { error: "Record the explanation before closing an exception." };
    await withUser(user.id, (tx) => tx`update public.reconciliation_exceptions set
        status = coalesce(${d.status ?? null}, status), classification = coalesce(${d.classification ?? null}, classification),
        assigned_to = coalesce(${d.assigned_to}::uuid, assigned_to), resolution_note = coalesce(${d.resolution_note}, resolution_note),
        resolved_by = case when ${d.status ?? ""} in ('explained','not_an_issue') then ${user.id}::uuid else resolved_by end,
        resolved_at = case when ${d.status ?? ""} in ('explained','not_an_issue') then now() else resolved_at end
      where id = any(${d.ids}::uuid[]) and status <> 'converted'`);
    revalidatePath(`/engagements/${d.engagement_id}/exceptions`, "layout");
    return { ok: true, message: `${d.ids.length} exception(s) updated.` };
  });
}

export async function exportExceptionsAction(fd: FormData) {
  const user = await requirePermission("recon.run");
  const id = z.string().uuid().parse(fd.get("engagement_id"));
  await withUser(user.id, (tx) => logAction(tx, { organisationId: user.orgId, actorId: user.id, action: "export", entityType: "reconciliation_exceptions", engagementId: id }));
  redirect(`/api/engagements/${id}/export/exceptions?${new URLSearchParams(Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)])))}`);
}
