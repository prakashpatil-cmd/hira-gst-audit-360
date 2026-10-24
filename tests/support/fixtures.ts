import { serviceSql } from "@/lib/db";
import { provisionUser } from "@/lib/auth/admin";
import { makeGstin } from "@/lib/gst/gstin";
import type { SessionUser, RoleCode } from "@/lib/auth/permissions";
import { claimJob, runJob } from "@/lib/jobs/queue";
import "@/lib/jobs/handlers";

export const PW = "Test@Passw0rd!";

export async function resetDb() {
  const sql = serviceSql();
  await sql.unsafe(`truncate public.organisations, auth.users, public.audit_controls, public.legal_references, public.rule_definitions cascade;`);
  await sql.unsafe(`alter table public.audit_logs disable trigger audit_logs_immutable; delete from public.audit_logs; alter table public.audit_logs enable trigger audit_logs_immutable;`);
}

export async function makeUser(orgId: string, email: string, role: RoleCode, clientId: string | null = null): Promise<SessionUser> {
  const sql = serviceSql();
  const id = await provisionUser({ email, fullName: email.split("@")[0], password: PW, sql });
  await sql`insert into public.memberships (organisation_id, user_id, role_code, client_id) values (${orgId}, ${id}, ${role}, ${clientId})`;
  return { id, email, fullName: email, memberships: [{ organisationId: orgId, role, clientId }], orgId, role,
    isClientUser: role === "client_user", clientIds: clientId ? [clientId] : [], mfaEnrolled: false, mfaVerified: true };
}

export async function makeWorld() {
  const sql = serviceSql();
  const [org] = await sql<{ id: string }[]>`insert into public.organisations (name, slug) values ('HIRA Associates', 'hira-test') returning id`;
  const mk = async (name: string, pan: string) => {
    const [c] = await sql<{ id: string }[]>`insert into public.clients (organisation_id, legal_name, pan, constitution) values (${org.id}, ${name}, ${pan}, 'private_limited') returning id`;
    const gstins: string[] = [];
    for (const st of ["27", "29", "19"]) {
      const [g] = await sql<{ id: string }[]>`insert into public.client_gstins (organisation_id, client_id, gstin, state_code)
        values (${org.id}, ${c.id}, ${makeGstin(st, pan)}, ${st}) returning id`;
      gstins.push(g.id);
    }
    const [e] = await sql<{ id: string }[]>`insert into public.audit_engagements (organisation_id, client_id, engagement_code, title, financial_year, period_from, period_to)
      values (${org.id}, ${c.id}, ${"ENG-" + pan}, ${name + " health check"}, '2026-27', '2026-04-01', '2026-06-30') returning id`;
    for (const g of gstins) await sql`insert into public.engagement_gstins values (${e.id}, ${g})`;
    return { clientId: c.id, gstinIds: gstins, engagementId: e.id, pan };
  };
  const A = await mk("Alpha Manufacturing Pvt Ltd", "AABCA1234F");
  const B = await mk("Beta Chemicals Pvt Ltd", "AABCB5678G");
  const admin = await makeUser(org.id, "admin@test.in", "super_admin");
  const manager = await makeUser(org.id, "manager@test.in", "audit_manager");
  const auditorA = await makeUser(org.id, "auditor.a@test.in", "gst_auditor");
  const auditorB = await makeUser(org.id, "auditor.b@test.in", "gst_auditor");
  const clientA = await makeUser(org.id, "cfo@alpha.in", "client_user", A.clientId);
  await sql`insert into public.audit_assignments (engagement_id, user_id, engagement_role) values (${A.engagementId}, ${auditorA.id}, 'auditor'), (${B.engagementId}, ${auditorB.id}, 'auditor')`;
  return { orgId: org.id, A, B, admin, manager, auditorA, auditorB, clientA };
}

/** Runs queued jobs synchronously (what the worker does). */
export async function drainJobs() {
  for (let i = 0; i < 50; i++) {
    const job = await claimJob();
    if (!job) return;
    const r = await runJob(job);
    if (!r.ok) throw new Error(`Job ${job.job_type} failed: ${r.error}`);
  }
}
