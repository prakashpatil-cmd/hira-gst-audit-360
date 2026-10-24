import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { fmtDate } from "@/lib/gst/dates";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Engagements" };

export default async function EngagementsPage() {
  const user = await requireUser();
  const rows = await withUser(user.id, (tx) => tx`
    select e.id, e.engagement_code, e.title, e.financial_year, e.period_from, e.period_to, e.status, e.completion_deadline, c.legal_name,
      (select string_agg(u.full_name, ', ') from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = e.id) team,
      (select count(*)::int from public.engagement_gstins g where g.engagement_id = e.id) gstins,
      (select count(*)::int from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
        where x.engagement_id = e.id and r.is_current and x.status in ('open','under_investigation')) open_exceptions,
      (select count(*)::int from public.audit_observations o where o.engagement_id = e.id) observations
    from public.audit_engagements e join public.clients c on c.id = e.client_id
    order by (e.status = 'closed'), e.period_to desc`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Engagements" description="GST Health Check and audit engagements you can access."
        actions={can(user, "engagements.manage") ? <Button asChild><Link href="/engagements/new"><Plus />New engagement</Link></Button> : null} />
      <Card>
        <Table>
          <THead><TR><TH>Engagement</TH><TH>Client</TH><TH>FY</TH><TH>Period</TH><TH className="text-right">GSTINs</TH><TH className="text-right">Open exceptions</TH><TH className="text-right">Observations</TH><TH>Deadline</TH><TH>Stage</TH></TR></THead>
          <TBody>
            {rows.length === 0 ? <Empty colSpan={9}>No engagements yet.</Empty> : rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/engagements/${r.id}`} className="font-medium text-hira-800 hover:underline">{r.engagement_code}</Link><div className="text-xs text-muted-foreground">{r.title}</div></TD>
                <TD>{r.legal_name}<div className="text-xs text-muted-foreground">{r.team ?? "Unassigned"}</div></TD>
                <TD>{r.financial_year}</TD><TD className="text-xs">{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</TD>
                <TD className="num">{r.gstins}</TD><TD className="num">{r.open_exceptions}</TD><TD className="num">{r.observations}</TD>
                <TD className={r.completion_deadline && r.completion_deadline < today && r.status !== "closed" ? "font-medium text-red-700" : ""}>{fmtDate(r.completion_deadline)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
