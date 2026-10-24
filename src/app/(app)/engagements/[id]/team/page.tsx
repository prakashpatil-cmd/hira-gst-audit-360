import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { assignmentAction } from "../../actions";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { team, staff, workload } = await withUser(user.id, async (tx) => ({
    team: await tx`select a.*, u.full_name, u.email, u.designation from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id}
      order by array_position(array['partner','manager','auditor','assistant'], a.engagement_role), u.full_name`,
    staff: await tx`select u.id, u.full_name, m.role_code from public.users u join public.memberships m on m.user_id = u.id
      where m.organisation_id = ${user.orgId} and m.role_code <> 'client_user' and m.is_active and u.is_active order by u.full_name`,
    workload: await tx`select u.full_name,
        (select count(*)::int from public.audit_test_results t where t.engagement_id = a.engagement_id and t.tested_by = u.id) tests,
        (select count(*)::int from public.audit_observations o where o.engagement_id = a.engagement_id and o.created_by = u.id) drafted,
        (select count(*)::int from public.reconciliation_exceptions x where x.engagement_id = a.engagement_id and x.assigned_to = u.id
           and x.status in ('open','under_investigation')) open_ex
      from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id} order by u.full_name`,
  }));
  const manage = can(user, "engagements.assign");
  return (
    <div className="space-y-6">
      <Section title="Engagement team" description="Auditors and assistants can only see engagements they are assigned to.">
        <Table><THead><TR><TH>Name</TH><TH>Engagement role</TH><TH>Modules</TH><TH /></TR></THead>
          <TBody>{team.length === 0 ? <Empty colSpan={4}>No one assigned.</Empty> : team.map((t) => (
            <TR key={t.id}><TD className="font-medium">{t.full_name}<div className="text-xs text-muted-foreground">{t.email}</div></TD>
              <TD><Badge variant="secondary">{t.engagement_role}</Badge></TD>
              <TD className="text-xs">{t.modules.length ? t.modules.map((m: string) => `${m} — ${MODULES[m]}`).join("; ") : "All modules"}</TD>
              <TD>{manage ? <ActionForm action={assignmentAction} inline submitLabel="Remove" submitVariant="ghost" confirm="Remove this person from the engagement?">
                <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="user_id" value={t.user_id} />
                <input type="hidden" name="engagement_role" value={t.engagement_role} /><input type="hidden" name="remove" value="1" /></ActionForm> : null}</TD></TR>))}
          </TBody></Table>
      </Section>
      {manage ? (
        <Section title="Assign a team member">
          <ActionForm action={assignmentAction} submitLabel="Save assignment" className="space-y-4 p-5">
            <input type="hidden" name="engagement_id" value={id} />
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Person"><Select name="user_id">{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role_code.replace(/_/g, " ")})</option>)}</Select></Field>
              <Field label="Role on engagement"><Select name="engagement_role" defaultValue="auditor">{["partner", "manager", "auditor", "assistant"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
            </div>
            <fieldset className="rounded-md border p-3"><legend className="px-1 text-sm font-medium">Modules (leave blank for all)</legend>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(MODULES).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="modules[]" value={k} className="h-4 w-4" />{k} — {v}</label>))}</div>
            </fieldset>
          </ActionForm>
        </Section>
      ) : null}
      <Section title="Team activity on this engagement">
        <Table><THead><TR><TH>Name</TH><TH className="text-right">Controls tested</TH><TH className="text-right">Observations drafted</TH><TH className="text-right">Open exceptions assigned</TH></TR></THead>
          <TBody>{workload.map((w) => <TR key={w.full_name}><TD>{w.full_name}</TD><TD className="num">{w.tests}</TD><TD className="num">{w.drafted}</TD><TD className="num">{w.open_ex}</TD></TR>)}</TBody></Table>
      </Section>
    </div>
  );
}
