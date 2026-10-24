"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { aiStatus, buildCaseFile, runAiTask, AI_TASKS, type AiTask } from "@/lib/ai";
import { logAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limit";

export async function aiAssist(observationId: string, engagementId: string, task: string): Promise<{ ok: boolean; text?: string; error?: string; model?: string }> {
  const user = await requirePermission("observations.edit");
  if (!(task in AI_TASKS)) return { ok: false, error: "Unknown task" };
  const st = await aiStatus(user.orgId);
  if (!st.enabled) return { ok: false, error: st.reason };
  if (!rateLimit(`ai:${user.id}`, 20, 60 * 60_000).ok) return { ok: false, error: "Hourly AI request limit reached." };
  try {
    const caseFile = await withUser(user.id, async (tx) => {
      const cf = await buildCaseFile(tx, observationId, st.allowClientData);
      await logAction(tx, { organisationId: user.orgId, actorId: user.id, action: "ai_request", entityType: "audit_observations", entityId: observationId,
        engagementId, context: { task, clientDataShared: st.allowClientData } });
      return cf;
    });
    const r = await runAiTask(caseFile, task as AiTask);
    return { ok: true, text: r.text, model: r.model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Places AI text into a section as a draft; the observation is flagged and needs human approval. */
export async function applyAiDraft(observationId: string, engagementId: string, field: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requirePermission("observations.edit");
  const f = z.enum(["observation_text", "action_required", "preventive_control", "financial_implication", "root_cause"]).parse(field);
  const body = text.split(/\n## /)[0].replace(/^## Draft\s*/i, "").trim();
  await withUser(user.id, async (tx) => {
    const r = await tx`update public.audit_observations set ${tx(f)} = ${body}, ai_generated = true, ai_approved_by = null,
        status = case when status in ('approved') then 'pending_review' else status end
      where id = ${observationId} and engagement_id = ${engagementId} and not locked`;
    if (!r.count) throw new Error("Observation is locked or not found.");
  });
  revalidatePath(`/engagements/${engagementId}/observations/${observationId}`);
  return { ok: true };
}
