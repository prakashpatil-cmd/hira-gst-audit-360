import { requirePermission } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { fmtDateTime } from "@/lib/gst/dates";
import { PageHeader, Section, Pager } from "@/components/app/page-header";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Security and audit logs" };
const PAGE = 100;

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string; page?: string; tab?: string }> }) {
  const admin = await requirePermission("logs.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const tab = sp.tab ?? "audit";
  const d = await withUser(admin.id, async (tx) => {
    if (tab === "logins") {
      const rows = await tx`select l.*, u.full_name from public.login_events l left join public.users u on u.id = l.user_id order by l.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.login_events`;
      return { rows, n };
    }
    const where = tx`${sp.entity ? tx`and l.entity_type = ${sp.entity}` : tx``} ${sp.action ? tx`and l.action = ${sp.action}` : tx``}`;
    const rows = await tx`select l.id, l.action, l.entity_type, l.entity_id, l.created_at, l.context, u.full_name, e.engagement_code,
        (select string_agg(k, ', ') from jsonb_object_keys(coalesce(l.after_data, '{}'::jsonb)) k
           where l.before_data is not null and l.after_data->k is distinct from l.before_data->k and k not in ('updated_at')) changed
      from public.audit_logs l left join public.users u on u.id = l.actor_id left join public.audit_engagements e on e.id = l.engagement_id
      where true ${where} order by l.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.audit_logs l where true ${where}`;
    return { rows, n };
  });
  const qs = (p: number) => `?tab=${tab}&page=${p}${sp.entity ? `&entity=${sp.entity}` : ""}${sp.action ? `&action=${sp.action}` : ""}`;
  return (
    <>
      <PageHeader title="Security and audit logs" description="Append-only record of changes to clients, engagements, imports, observations, approvals, reports, downloads and exports, plus sign-in activity. Transaction values and file contents are not written to application logs." />
      <div className="mb-4 flex gap-2">
        <a href="?tab=audit" className={`rounded-md border px-3 py-1.5 text-sm ${tab === "audit" ? "bg-primary text-white" : ""}`}>Activity log</a>
        <a href="?tab=logins" className={`rounded-md border px-3 py-1.5 text-sm ${tab === "logins" ? "bg-primary text-white" : ""}`}>Sign-in history</a>
      </div>
      {tab === "logins" ? (
        <Section title="Sign-in history">
          <Table><THead><TR><TH>When</TH><TH>User</TH><TH>Event</TH><TH>IP</TH><TH>Device</TH></TR></THead>
            <TBody>{d.rows.length === 0 ? <Empty colSpan={5}>No events.</Empty> : d.rows.map((r) => (
              <TR key={r.id}><TD className="text-xs">{fmtDateTime(r.created_at)}</TD><TD>{r.full_name ?? r.email}</TD>
                <TD><Badge variant={/fail|lock/.test(r.event) ? "high" : "secondary"}>{r.event.replace(/_/g, " ")}</Badge></TD><TD className="font-mono text-xs">{r.ip ?? "—"}</TD>
                <TD className="max-w-xs truncate text-xs text-muted-foreground">{r.user_agent}</TD></TR>))}</TBody></Table>
          <Pager page={page} pageSize={PAGE} total={d.n} href={qs} />
        </Section>
      ) : (
        <Section title="Activity log" actions={<form className="flex gap-2"><input type="hidden" name="tab" value="audit" />
          <Input name="entity" defaultValue={sp.entity} placeholder="Entity (e.g. audit_observations)" className="h-8 w-56 text-xs" />
          <Select name="action" defaultValue={sp.action ?? ""} className="h-8 w-36 text-xs"><option value="">Any action</option>{["insert", "update", "delete", "download", "export", "ai_request", "user_reset", "user_deactivate"].map((a) => <option key={a}>{a}</option>)}</Select>
          <Button size="sm" variant="outline">Filter</Button></form>}>
          <Table><THead><TR><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Record</TH><TH>Engagement</TH><TH>Fields changed</TH></TR></THead>
            <TBody>{d.rows.length === 0 ? <Empty colSpan={6}>No activity.</Empty> : d.rows.map((r) => (
              <TR key={r.id}><TD className="text-xs">{fmtDateTime(r.created_at)}</TD><TD>{r.full_name ?? "System"}</TD><TD><Badge variant="muted">{r.action}</Badge></TD>
                <TD className="text-xs">{r.entity_type.replace(/_/g, " ")}<div className="font-mono text-[10px] text-muted-foreground">{r.entity_id}</div></TD>
                <TD className="text-xs">{r.engagement_code ?? "—"}</TD><TD className="max-w-sm text-xs text-muted-foreground">{r.changed ?? ""}</TD></TR>))}</TBody></Table>
          <Pager page={page} pageSize={PAGE} total={d.n} href={qs} />
        </Section>
      )}
    </>
  );
}
