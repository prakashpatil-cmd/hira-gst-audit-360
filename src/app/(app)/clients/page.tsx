import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Client master" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const like = `%${q}%`;
  const rows = await withUser(user.id, (tx) => tx`
    select c.id, c.legal_name, c.trade_name, c.pan, c.industry, c.status,
      (select count(*)::int from public.client_gstins g where g.client_id = c.id) gstins,
      (select count(*)::int from public.business_locations l where l.client_id = c.id and l.is_active) locations,
      (select count(*)::int from public.audit_engagements e where e.client_id = c.id and e.status <> 'closed') active_engagements
    from public.clients c
    where ${q ? tx`(c.legal_name ilike ${like} or c.trade_name ilike ${like} or c.pan ilike ${like})` : tx`true`}
    order by c.legal_name limit 500`);
  return (
    <>
      <PageHeader title="Client master" description="Legal entities, GST registrations and places of business."
        actions={can(user, "clients.manage") ? <Button asChild><Link href="/clients/new"><Plus />New client</Link></Button> : null} />
      <form className="mb-4 max-w-sm"><Input name="q" defaultValue={q} placeholder="Search by name or PAN…" /></form>
      <Card>
        <Table>
          <THead><TR><TH>Client</TH><TH>PAN</TH><TH>Industry</TH><TH className="text-right">GSTINs</TH><TH className="text-right">Locations</TH><TH className="text-right">Open engagements</TH><TH>Status</TH></TR></THead>
          <TBody>
            {rows.length === 0 ? <Empty colSpan={7}>No clients yet.</Empty> : rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/clients/${r.id}`} className="font-medium text-hira-800 hover:underline">{r.legal_name}</Link>{r.trade_name ? <div className="text-xs text-muted-foreground">{r.trade_name}</div> : null}</TD>
                <TD className="font-mono text-xs">{r.pan}</TD>
                <TD>{r.industry ?? "—"}</TD>
                <TD className="num">{r.gstins}</TD>
                <TD className="num">{r.locations}</TD>
                <TD className="num">{r.active_engagements}</TD>
                <TD><StatusBadge status={r.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
