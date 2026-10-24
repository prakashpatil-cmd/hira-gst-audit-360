import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionsTable } from "@/components/app/actions-table";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Corrective actions" };

export default async function FirmActions({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const { filter = "open" } = await searchParams;
  const rows = await withUser(user.id, (tx) => tx`select a.*, o.obs_number, e.engagement_code, c.legal_name from public.corrective_actions a
    join public.audit_engagements e on e.id = a.engagement_id join public.clients c on c.id = e.client_id left join public.audit_observations o on o.id = a.observation_id
    where ${filter === "all" ? tx`true` : filter === "overdue" ? tx`a.status in ('open','in_progress') and a.due_date < current_date`
      : filter === "verify" ? tx`a.status = 'completed'` : tx`a.status in ('open','in_progress')`}
    order by a.statutory_deadline nulls last, a.due_date nulls last, a.priority limit 1000`);
  return (
    <>
      <PageHeader title="Corrective action tracker" description="Post-audit follow-up across all engagements you can access: DRC-03 payments, return amendments, PMT-09 transfers and control changes." />
      <Section title={`${rows.length} action(s)`} actions={<form className="flex gap-2"><Select name="filter" defaultValue={filter} className="h-8 w-48 text-xs">
        <option value="open">Open</option><option value="overdue">Overdue</option><option value="verify">Completed — awaiting verification</option><option value="all">All</option></Select><Button size="sm" variant="outline">Show</Button></form>}>
        <ActionsTable rows={rows} showEngagement canVerify={can(user, "actions.manage")} />
      </Section>
    </>
  );
}
