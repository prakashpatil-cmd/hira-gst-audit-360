"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr } from "@/lib/actions";
import type { ActionState } from "@/components/app/action-form";

export async function saveTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("observations.approve");
    const d = z.object({ from_observation: zOptStr, module: z.string().regex(/^[A-Q]$/), category: z.string().min(2), title: z.string().min(3),
      observation_text: z.string().min(10), legal_framework: z.string(), action_required: z.string().min(5), preventive_control: z.string().default(""),
      risk_grade: z.enum(["critical", "high", "medium", "low", "opportunity"]), tags: zOptStr, industries: zOptStr }).parse(formObject(fd));
    await withUser(user.id, (tx) => tx`insert into public.observation_templates (organisation_id, module, category, title, observation_text, legal_framework, action_required,
        preventive_control, risk_grade, tags, industries, is_approved, created_by)
      values (${user.orgId}, ${d.module}, ${d.category}, ${d.title}, ${d.observation_text}, ${d.legal_framework}, ${d.action_required}, ${d.preventive_control}, ${d.risk_grade},
        ${d.tags ? d.tags.split(",").map((s) => s.trim()) : []}, ${d.industries ? d.industries.split(",").map((s) => s.trim()) : []}, true, ${user.id})`);
    revalidatePath("/library");
    return { ok: true, message: "Template saved. Remove client names and figures before reuse — templates are visible firm-wide." };
  });
}
