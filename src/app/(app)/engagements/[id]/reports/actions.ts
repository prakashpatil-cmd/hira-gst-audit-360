"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr } from "@/lib/actions";
import { buildReportSnapshot, type ReportContent, type ReportSnapshot } from "@/lib/reports/snapshot";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJob } from "@/lib/jobs/kick";
import { createHash } from "node:crypto";
import type { ActionState } from "@/components/app/action-form";

const CONTENT_KEYS = ["managementIntro", "recommendations", "bottomLine", "background", "methodology", "closing", "roadmap"] as const;

async function revisions(tx: Parameters<Parameters<typeof withUser>[1]>[0], engagementId: string) {
  return (await tx`select version, label, status, coalesce(approved_at, generated_at, created_at) at, revision_note note from public.report_versions where engagement_id = ${engagementId} order by version`)
    .map((r) => ({ version: r.version, label: r.label, status: r.status, at: r.at ? new Date(r.at).toISOString() : null, note: r.note }));
}

export async function createReportVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("reports.generate");
    const d = z.object({ engagement_id: z.string().uuid(), revision_note: zOptStr }).parse(formObject(fd));
    const jobId = await withUser(user.id, async (tx) => {
      const [prev] = await tx`select content from public.report_versions where engagement_id = ${d.engagement_id} order by version desc limit 1`;
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(version), 0) + 1 n from public.report_versions where engagement_id = ${d.engagement_id}`;
      const content = (prev?.content ?? {}) as ReportContent;
      const revs = [...(await revisions(tx, d.engagement_id)), { version: n, label: "DRAFT", status: "draft", at: new Date().toISOString(), note: d.revision_note }];
      const { snapshot, hash } = await buildReportSnapshot(tx, d.engagement_id, content, revs);
      if (snapshot.observations.length === 0) throw new Error("No approved observations yet — approve observations in Team Review before generating a report.");
      await tx`update public.report_versions set status = 'superseded' where engagement_id = ${d.engagement_id} and status in ('draft','pending_approval')`;
      const [v] = await tx<{ id: string }[]>`insert into public.report_versions (organisation_id, engagement_id, version, label, status, content, snapshot, snapshot_hash, revision_note, generated_by)
        values (${user.orgId}, ${d.engagement_id}, ${n}, 'DRAFT', 'draft', ${tx.json(content as never)}, ${tx.json(snapshot as never)}, ${hash}, ${d.revision_note}, ${user.id}) returning id`;
      return enqueueJob(tx, { organisationId: user.orgId, engagementId: d.engagement_id, type: "report.generate", payload: { versionId: v.id }, createdBy: user.id });
    });
    await kickJob(jobId);
    revalidatePath(`/engagements/${d.engagement_id}/reports`);
    return { ok: true, message: "Draft report version created from the approved observations." };
  });
}

export async function saveReportContentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("reports.generate");
    const o = formObject(fd);
    const d = z.object({ engagement_id: z.string().uuid(), version_id: z.string().uuid() }).parse(o);
    const content: ReportContent = {};
    for (const k of CONTENT_KEYS) if (typeof o[k] === "string") content[k] = (o[k] as string).trim();
    const jobId = await withUser(user.id, async (tx) => {
      const [v] = await tx`select status, snapshot from public.report_versions where id = ${d.version_id} and engagement_id = ${d.engagement_id}`;
      if (!v || v.status !== "draft") throw new Error("Only a draft version can be edited. Create a new revision instead.");
      // Narrative only: observations and figures in the frozen snapshot are not refreshed.
      const snap = v.snapshot as ReportSnapshot;
      snap.content = { ...snap.content, ...Object.fromEntries(Object.entries(content).filter(([, x]) => x)) } as ReportSnapshot["content"];
      const hash = createHash("sha256").update(JSON.stringify({ ...snap, generatedAt: undefined })).digest("hex");
      await tx`update public.report_versions set content = ${tx.json(content as never)}, snapshot = ${tx.json(snap as never)}, snapshot_hash = ${hash} where id = ${d.version_id}`;
      return enqueueJob(tx, { organisationId: user.orgId, engagementId: d.engagement_id, type: "report.generate", payload: { versionId: d.version_id }, createdBy: user.id });
    });
    await kickJob(jobId);
    revalidatePath(`/engagements/${d.engagement_id}/reports`);
    return { ok: true, message: "Narrative saved and the draft PDF regenerated." };
  });
}

export async function reportWorkflowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const d = z.object({ engagement_id: z.string().uuid(), version_id: z.string().uuid(), op: z.enum(["submit", "approve", "issue", "return"]), comment: zOptStr }).parse(formObject(fd));
    const user = await requirePermission(d.op === "submit" ? "reports.generate" : "reports.approve");
    const jobId = await withUser(user.id, async (tx) => {
      const [v] = await tx`select * from public.report_versions where id = ${d.version_id} and engagement_id = ${d.engagement_id} for update`;
      if (!v) throw new Error("Version not found");
      const need: Record<string, string> = { submit: "draft", approve: "pending_approval", issue: "approved", return: "pending_approval" };
      if (v.status !== need[d.op]) throw new Error(`Version is ${v.status.replace(/_/g, " ")}.`);
      if (d.op === "approve") {
        // Re-check: every observation in the snapshot must still be approved and unchanged.
        const snap = v.snapshot as ReportSnapshot;
        const live = await tx`select id, status from public.audit_observations where id = any(${snap.observations.map((o) => o.id)}::uuid[])`;
        const bad = live.filter((l) => !["approved", "shared_with_client", "client_responded", "final", "resolved", "closed"].includes(l.status));
        if (bad.length) throw new Error(`${bad.length} observation(s) in this version have been reopened since it was created. Create a new revision.`);
        const revs = (snap.revisions ?? []).map((r) => r.version === v.version ? { ...r, label: "FINAL", status: "approved", at: new Date().toISOString() } : r);
        snap.revisions = revs;
        await tx`update public.report_versions set snapshot = ${tx.json(snap as never)}, label = 'FINAL' where id = ${v.id}`;
        await tx`update public.report_versions set status = 'approved', approved_by = ${user.id}, approved_at = now() where id = ${v.id}`;
        await tx`update public.audit_observations set status = 'final', locked = true where id = any(${snap.observations.map((o) => o.id)}::uuid[]) and status in ('approved','shared_with_client','client_responded')`;
      } else if (d.op === "issue") {
        await tx`update public.report_versions set status = 'issued' where id = ${v.id}`;
        await tx`update public.audit_engagements set report_issue_date = current_date, status = case when status in ('finalisation','client_discussion','internal_review','drafting') then 'follow_up' else status end where id = ${d.engagement_id}`;
      } else {
        await tx`update public.report_versions set status = ${d.op === "submit" ? "pending_approval" : "draft"} where id = ${v.id}`;
      }
      await tx`insert into public.review_approvals (organisation_id, engagement_id, entity_type, entity_id, action, comment, actor_id)
        values (${user.orgId}, ${d.engagement_id}, 'report', ${v.id}, ${d.op === "approve" ? "sign" : d.op === "return" ? "request_changes" : d.op === "submit" ? "submit" : "approve"}, ${d.comment}, ${user.id})`;
      return d.op === "approve" ? enqueueJob(tx, { organisationId: user.orgId, engagementId: d.engagement_id, type: "report.generate", payload: { versionId: v.id }, createdBy: user.id }) : null;
    });
    if (jobId) await kickJob(jobId);
    revalidatePath(`/engagements/${d.engagement_id}`, "layout");
    // The pressed button disappears with the new status, so confirm on the page itself.
    redirect(`/engagements/${d.engagement_id}/reports?done=${d.op}`);
  });
}

export async function regenerateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("reports.generate");
    const d = z.object({ engagement_id: z.string().uuid(), version_id: z.string().uuid() }).parse(formObject(fd));
    const jobId = await withUser(user.id, (tx) => enqueueJob(tx, { organisationId: user.orgId, engagementId: d.engagement_id, type: "report.generate", payload: { versionId: d.version_id }, createdBy: user.id }));
    await kickJob(jobId);
    revalidatePath(`/engagements/${d.engagement_id}/reports`);
    return { ok: true, message: "Regeneration started." };
  });
}
