"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser, serviceSql } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate } from "@/lib/actions";
import { provisionUser, resetUserPassword } from "@/lib/auth/admin";
import { logAction } from "@/lib/audit-log";
import type { ActionState } from "@/components/app/action-form";

const ROLE = z.enum(["super_admin", "audit_manager", "gst_auditor", "audit_assistant", "client_user"]);

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await requirePermission("users.manage");
    const d = z.object({ email: z.string().email(), full_name: z.string().min(2), designation: zOptStr, role: ROLE, client_id: zOptStr, password: z.string().min(10),
      mfa_enforced: z.boolean() }).parse({ ...formObject(fd), mfa_enforced: fd.get("mfa_enforced") === "on" });
    if (d.role === "client_user" && !d.client_id) return { error: "Select the client for a client user." };
    // RLS check first: the admin must be able to manage memberships in this organisation.
    await withUser(admin.id, async (tx) => {
      const [ok] = await tx`select 1 from public.organisations where id = ${admin.orgId}`;
      if (!ok) throw new Error("Not permitted");
      if (d.client_id) { const [c] = await tx`select 1 from public.clients where id = ${d.client_id}`; if (!c) throw new Error("Client not found"); }
    });
    const id = await provisionUser({ email: d.email, fullName: d.full_name, password: d.password, designation: d.designation });
    await withUser(admin.id, async (tx) => {
      await tx`update public.users set mfa_enforced = ${d.mfa_enforced} where id = ${id}`;
      await tx`insert into public.memberships (organisation_id, user_id, role_code, client_id) values (${admin.orgId}, ${id}, ${d.role}, ${d.role === "client_user" ? d.client_id : null})`;
    });
    revalidatePath("/admin/users");
    return { ok: true, message: `User ${d.email} created. Share the temporary password securely; ask them to change it at first sign-in.` };
  });
}

export async function updateUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await requirePermission("users.manage");
    const d = z.object({ user_id: z.string().uuid(), op: z.enum(["activate", "deactivate", "role", "reset", "mfa_on", "mfa_off", "revoke_sessions"]), role: ROLE.optional(),
      password: zOptStr }).parse(formObject(fd));
    if (d.user_id === admin.id && ["deactivate", "role"].includes(d.op)) return { error: "You cannot change your own access." };
    await withUser(admin.id, async (tx) => {
      const [m] = await tx`select id from public.memberships where user_id = ${d.user_id} and organisation_id = ${admin.orgId}`;
      if (!m) throw new Error("User is not in your organisation");
      if (d.op === "activate" || d.op === "deactivate") await tx`update public.users set is_active = ${d.op === "activate"} where id = ${d.user_id}`;
      if (d.op === "mfa_on" || d.op === "mfa_off") await tx`update public.users set mfa_enforced = ${d.op === "mfa_on"} where id = ${d.user_id}`;
      if (d.op === "role" && d.role) {
        if (d.role === "client_user") throw new Error("Create a separate client user instead of converting staff.");
        await tx`update public.memberships set role_code = ${d.role} where id = ${m.id} and role_code <> 'client_user'`;
      }
      await logAction(tx, { organisationId: admin.orgId, actorId: admin.id, action: `user_${d.op}`, entityType: "users", entityId: d.user_id });
    });
    if (d.op === "reset") {
      if (!d.password) return { error: "Enter a temporary password." };
      await resetUserPassword(d.user_id, d.password);
    }
    if (d.op === "deactivate" || d.op === "revoke_sessions" || d.op === "reset") {
      await serviceSql()`delete from local_auth.sessions where user_id = ${d.user_id}`.catch(() => undefined);
    }
    revalidatePath("/admin/users");
    return { ok: true, message: "User updated." };
  });
}

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const admin = await requirePermission("settings.manage");
    const o = formObject(fd);
    const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    const brand = { firmName: s("firmName"), tagline: s("tagline"), primary: s("primary") || "#81BB41", secondary: s("secondary") || "#878787", logoPath: s("logoPath") || "/brand/hira-logo.png" };
    const report = { footerLine1: s("footerLine1"), footerLine2: s("footerLine2"), website: s("website"), address: s("address"), signatory: s("signatory"),
      signatoryTitle: s("signatoryTitle"), confidentiality: s("confidentiality"), disclaimer: s("disclaimer"), productName: "HIRA GST Audit 360°",
      productTagline: "Every Transaction Verified. Every GST Risk Identified." };
    const security = { sessionIdleMinutes: Number(o.sessionIdleMinutes) || 60, requireMfaForAdmins: o.requireMfaForAdmins === true, maxUploadMb: Number(o.maxUploadMb) || 50 };
    const ai = { enabled: o.aiEnabled === true, allowClientData: o.aiAllowClientData === true };
    for (const [k, v] of Object.entries({ ...brand, ...report })) if (!v && !["logoPath"].includes(k)) return { error: `${k} is required` };
    await withUser(admin.id, (tx) => tx`insert into public.system_settings (organisation_id, brand, report, security, ai, updated_by)
      values (${admin.orgId}, ${tx.json(brand)}, ${tx.json(report)}, ${tx.json(security)}, ${tx.json(ai)}, ${admin.id})
      on conflict (organisation_id) do update set brand = excluded.brand, report = excluded.report, security = excluded.security, ai = excluded.ai, updated_by = excluded.updated_by, updated_at = now()`);
    revalidatePath("/admin/settings");
    return { ok: true, message: "Settings saved. New report versions will use them; existing versions keep their frozen settings." };
  });
}

export async function ruleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const o = formObject(fd);
    const op = z.enum(["propose", "approve", "reject", "retire"]).parse(o.op);
    const user = await requirePermission(op === "propose" ? "rules.propose" : "rules.approve");
    await withUser(user.id, async (tx) => {
      if (op === "propose") {
        const d = z.object({ rule_code: z.string().min(3), title: z.string().min(3), params: z.string(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          effective_to: zOptDate, change_note: z.string().min(5, "Explain the change"), legal_basis: zOptStr }).parse(o);
        let params: unknown;
        try { params = JSON.parse(d.params); } catch { throw new Error("Parameters must be valid JSON"); }
        const [prev] = await tx`select * from public.rule_definitions where rule_code = ${d.rule_code} order by version desc limit 1`;
        if (!prev) throw new Error("Unknown rule code");
        await tx`insert into public.rule_definitions (rule_code, version, module, title, taxpayer_classes, effective_from, effective_to, legal_basis, input_fields, conditions, calc_method,
            params, severity, tolerances, evidence_requirements, status, proposed_by, change_note)
          values (${d.rule_code}, ${prev.version + 1}, ${prev.module}, ${d.title}, ${prev.taxpayer_classes}, ${d.effective_from}, ${d.effective_to},
            ${d.legal_basis ? d.legal_basis.split(",").map((x) => x.trim()) : prev.legal_basis}, ${prev.input_fields}, ${prev.conditions}, ${prev.calc_method},
            ${tx.json(params as never)}, ${prev.severity}, ${prev.tolerances}, ${prev.evidence_requirements}, 'pending_approval', ${user.id}, ${d.change_note})`;
        return;
      }
      const id = z.string().uuid().parse(o.id);
      const kind = z.enum(["rule", "control"]).parse(o.kind ?? "rule");
      const table = kind === "rule" ? "rule_definitions" : "control_versions";
      if (op === "approve") {
        const [r] = await tx`select * from ${tx(`public.${table}`)} where id = ${id}`;
        if (kind === "rule" && r.proposed_by === user.id) throw new Error("Segregation of duties: the proposer cannot approve the same rule change.");
        await tx`update ${tx(`public.${table}`)} set status = 'approved', approved_by = ${user.id}, approved_at = now() where id = ${id}`;
        if (kind === "rule") await tx`update public.rule_definitions set reviewed_by = ${user.id} where id = ${id}`;
      } else {
        await tx`update ${tx(`public.${table}`)} set status = ${op === "retire" ? "retired" : "draft"} where id = ${id}`;
      }
      await tx`insert into public.review_approvals (organisation_id, entity_type, entity_id, action, comment, actor_id)
        values (${user.orgId}, ${kind === "rule" ? "rule_definition" : "control_version"}, ${id}, ${op === "approve" ? "approve" : "reject"}, ${(o.comment as string) ?? null}, ${user.id})`;
    });
    revalidatePath("/admin/rules");
    return { ok: true, message: op === "propose" ? "Change proposed for approval. Engagements already started keep their pinned version." : "Updated." };
  });
}
