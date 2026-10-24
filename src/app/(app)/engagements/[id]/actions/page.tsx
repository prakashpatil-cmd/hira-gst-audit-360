import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { Section, Stat } from "@/components/app/page-header";
import { ActionsTable } from "@/components/app/actions-table";
import { todayIso } from "@/lib/gst/dates";

export default async function EngagementActions({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const rows = await withUser(user.id, (tx) => tx`select a.*, o.obs_number from public.corrective_actions a left join public.audit_observations o on o.id = a.observation_id
    where a.engagement_id = ${id} order by (a.status in ('completed','verified','cancelled')), a.statutory_deadline nulls last, a.priority, a.due_date nulls last`);
  const today = todayIso();
  const open = rows.filter((r) => !["completed", "verified", "cancelled"].includes(r.status));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Open actions" value={open.length} />
        <Stat label="Overdue" value={open.filter((r) => r.due_date && r.due_date < today).length} tone="danger" />
        <Stat label="Completed, awaiting verification" value={rows.filter((r) => r.status === "completed").length} />
        <Stat label="Verified" value={rows.filter((r) => r.status === "verified").length} tone="good" />
      </div>
      <Section title="Priority action plan and corrective action tracker" description="Ordered by statutory deadline, then urgency. Completion requires evidence; verification is by the audit team.">
        <ActionsTable rows={rows} canVerify={can(user, "actions.manage")} />
      </Section>
    </div>
  );
}
