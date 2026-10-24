"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate, zMoney } from "@/lib/actions";
import { setupEngagementProgramme, STAGES } from "@/lib/engagements";
import { financialYear } from "@/lib/gst/dates";
import type { ActionState } from "@/components/app/action-form";

const engSchema = z.object({
  client_id: z.string().uuid(),
  title: z.string().trim().min(3),
  audit_type: z.enum(["health_check", "annual_return_review", "pre_departmental_audit", "notice_support", "special_review", "refund_review"]),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: zOptStr, exclusions: zOptStr,
  data_request_date: zOptDate, completion_deadline: zOptDate,
  engagement_partner_id: zOptStr, reviewing_manager_id: zOptStr,
  materiality_amount: zMoney, tolerance_amount: zMoney,
  gstins: z.array(z.string().uuid()).min(1, "Select at least one GSTIN"),
  locations: z.array(z.string().uuid()).optional(),
  auditors: z.array(z.string().uuid()).optional(),
  assistants: z.array(z.string().uuid()).optional(),
}).refine((d) => d.period_to >= d.period_from, { message: "Period end must be after period start", path: ["period_to"] });

export async function createEngagementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("engagements.manage");
    const d = engSchema.parse(formObject(fd));
    const id = await withUser(user.id, async (tx) => {
      const fy = financialYear(d.period_from);
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int + 1 n from public.audit_engagements where financial_year = ${fy}`;
      const code = `HGA-${fy.replace("-", "")}-${String(n).padStart(3, "0")}`;
      const [e] = await tx<{ id: string }[]>`insert into public.audit_engagements (organisation_id, client_id, engagement_code, title, financial_year, period_from, period_to,
          audit_type, scope, exclusions, data_request_date, completion_deadline, engagement_partner_id, reviewing_manager_id, materiality_amount, tolerance_amount, created_by)
        values (${user.orgId}, ${d.client_id}, ${code}, ${d.title}, ${fy}, ${d.period_from}, ${d.period_to}, ${d.audit_type}, ${d.scope}, ${d.exclusions},
          ${d.data_request_date}, ${d.completion_deadline}, ${d.engagement_partner_id}, ${d.reviewing_manager_id}, ${d.materiality_amount}, ${d.tolerance_amount}, ${user.id})
        returning id`;
      for (const g of d.gstins) await tx`insert into public.engagement_gstins values (${e.id}, ${g})`;
      for (const l of d.locations ?? []) await tx`insert into public.engagement_locations (engagement_id, location_id) values (${e.id}, ${l})`;
      const assign = async (uid: string | null, role: string) => {
        if (uid) await tx`insert into public.audit_assignments (engagement_id, user_id, engagement_role, assigned_by) values (${e.id}, ${uid}, ${role}, ${user.id})
          on conflict (engagement_id, user_id) do nothing`;
      };
      await assign(d.engagement_partner_id, "partner");
      await assign(d.reviewing_manager_id, "manager");
      for (const a of d.auditors ?? []) await assign(a, "auditor");
      for (const a of d.assistants ?? []) await assign(a, "assistant");
      await setupEngagementProgramme(tx, e.id, user.id);
      return e.id;
    });
    redirect(`/engagements/${id}`);
  });
}

export async function updateEngagementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("engagements.manage");
    const o = formObject(fd);
    const id = z.string().uuid().parse(o.id);
    const d = z.object({
      title: z.string().trim().min(3), scope: zOptStr, exclusions: zOptStr, data_request_date: zOptDate, completion_deadline: zOptDate,
      report_issue_date: zOptDate, materiality_amount: zMoney, tolerance_amount: zMoney,
      status: z.enum(STAGES.map((s) => s.key) as [string, ...string[]]),
      visit_label: zOptStr, visit_from: zOptDate, visit_to: zOptDate,
    }).parse(o);
    await withUser(user.id, async (tx) => {
      const r = await tx`update public.audit_engagements set title = ${d.title}, scope = ${d.scope}, exclusions = ${d.exclusions},
          data_request_date = ${d.data_request_date}, completion_deadline = ${d.completion_deadline}, report_issue_date = ${d.report_issue_date},
          materiality_amount = ${d.materiality_amount}, tolerance_amount = ${d.tolerance_amount}, status = ${d.status},
          audit_visits = case when ${d.visit_label}::text is null then audit_visits
                              else audit_visits || jsonb_build_array(jsonb_build_object('label', ${d.visit_label}::text, 'from', ${d.visit_from}::text, 'to', ${d.visit_to}::text)) end
        where id = ${id}`;
      if (r.count === 0) throw new Error("You are not the manager of this engagement.");
    });
    revalidatePath(`/engagements/${id}`, "layout");
    return { ok: true, message: "Engagement updated." };
  });
}

export async function assignmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("engagements.assign");
    const o = formObject(fd);
    const d = z.object({ engagement_id: z.string().uuid(), user_id: z.string().uuid(), engagement_role: z.enum(["partner", "manager", "auditor", "assistant"]),
      modules: z.array(z.string().regex(/^[A-Q]$/)).optional(), remove: z.boolean().optional() }).parse({ ...o, remove: o.remove === "1" });
    await withUser(user.id, async (tx) => {
      if (d.remove) await tx`delete from public.audit_assignments where engagement_id = ${d.engagement_id} and user_id = ${d.user_id}`;
      else await tx`insert into public.audit_assignments (engagement_id, user_id, engagement_role, modules, assigned_by)
        values (${d.engagement_id}, ${d.user_id}, ${d.engagement_role}, ${d.modules ?? []}, ${user.id})
        on conflict (engagement_id, user_id) do update set engagement_role = excluded.engagement_role, modules = excluded.modules`;
    });
    revalidatePath(`/engagements/${d.engagement_id}/team`);
    return { ok: true, message: d.remove ? "Assignment removed." : "Assignment saved." };
  });
}

export async function refreshProgrammeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser();
    const id = z.string().uuid().parse(fd.get("engagement_id"));
    const r = await withUser(user.id, (tx) => setupEngagementProgramme(tx, id, user.id));
    revalidatePath(`/engagements/${id}`, "layout");
    return { ok: true, message: `Programme refreshed: ${r.controls} controls; client profile ${r.classes.join(", ")}.` };
  });
}
