import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { getEngagement } from "@/lib/queries";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtPeriod } from "@/lib/gst/dates";
import { Section, Stat, Pager } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Select, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { RiskBadge, StatusBadge, Badge } from "@/components/ui/badge";
import { triageExceptionAction } from "../reconciliation/actions";

const PAGE = 100;
type SP = { severity?: string; status?: string; module?: string; type?: string; gstin?: string; run?: string; page?: string; q?: string };

export default async function ExceptionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const d = await withUser(user.id, async (tx) => {
    const where = tx`x.engagement_id = ${id} and ${sp.run ? tx`x.run_id = ${sp.run}` : tx`r.is_current`}
      ${sp.severity ? tx`and x.severity = ${sp.severity}` : tx``} ${sp.status ? tx`and x.status = ${sp.status}` : tx`and x.status in ('open','under_investigation')`}
      ${sp.module ? tx`and x.module = ${sp.module}` : tx``} ${sp.type ? tx`and x.exception_type = ${sp.type}` : tx``}
      ${sp.gstin ? tx`and x.client_gstin_id = ${sp.gstin}` : tx``}
      ${sp.q ? tx`and (x.doc_no ilike ${"%" + sp.q + "%"} or x.counterparty_gstin ilike ${"%" + sp.q + "%"} or x.counterparty_name ilike ${"%" + sp.q + "%"})` : tx``}`;
    const rows = await tx`select x.*, g.gstin our_gstin, u.full_name assignee from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      left join public.client_gstins g on g.id = x.client_gstin_id left join public.users u on u.id = x.assigned_to
      where ${where} order by case x.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'opportunity' then 3 else 4 end, abs(x.diff_tax) desc, x.doc_no
      limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const [agg] = await tx`select count(*)::int n, coalesce(sum(x.diff_tax) filter (where x.diff_tax > 0 and x.severity <> 'opportunity'), 0)::text exposure,
        coalesce(sum(abs(x.diff_tax)) filter (where x.severity = 'opportunity'), 0)::text opportunity
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id where ${where}`;
    const types = await tx`select x.exception_type, count(*)::int n from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      where x.engagement_id = ${id} and r.is_current group by 1 order by 2 desc`;
    const staff = await tx`select u.id, u.full_name from public.audit_assignments a join public.users u on u.id = a.user_id where a.engagement_id = ${id}`;
    return { rows, agg, types, staff };
  });
  const gstins = (await getEngagement(user, id)).gstins;
  const qs = (o: Partial<SP>) => `?${new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const triage = can(user, "recon.run");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Exceptions in view" value={d.agg.n.toLocaleString("en-IN")} />
        <Stat label="Indicative tax exposure in view" value={`₹${inr(d.agg.exposure, { decimals: 0 })}`} sub="Positive tax differences — before investigation; not a confirmed liability" tone="danger" />
        <Stat label="Potential opportunities in view" value={`₹${inr(d.agg.opportunity, { decimals: 0 })}`} sub="Unclaimed credit, excess payment, idle balances" tone="info" />
      </div>
      <Section title="Exception register" description="Every exception links to its original source rows. Missing documents are recorded as documentary deficiencies, not proved defaults."
        actions={<a className="text-sm text-primary hover:underline" href={`/api/engagements/${id}/export/exceptions${qs({ page: undefined })}`}>Export to Excel</a>}>
        <form className="flex flex-wrap gap-2 border-b p-3">
          <Select name="severity" defaultValue={sp.severity ?? ""} className="h-8 w-32 text-xs"><option value="">Any risk</option>{["critical", "high", "medium", "low", "opportunity"].map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="h-8 w-40 text-xs"><option value="">Open & investigating</option>{["open", "under_investigation", "explained", "not_an_issue", "converted"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
          <Select name="module" defaultValue={sp.module ?? ""} className="h-8 w-48 text-xs"><option value="">Any module</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select>
          <Select name="type" defaultValue={sp.type ?? ""} className="h-8 w-56 text-xs"><option value="">Any type</option>{d.types.map((t) => <option key={t.exception_type} value={t.exception_type}>{t.exception_type.replace(/_/g, " ")} ({t.n})</option>)}</Select>
          <Select name="gstin" defaultValue={sp.gstin ?? ""} className="h-8 w-48 text-xs"><option value="">Any GSTIN</option>{gstins.map((g) => <option key={g.id} value={g.id}>{g.gstin}</option>)}</Select>
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Document / party" className="h-8 w-40 text-xs" />
          <Button size="sm" variant="outline">Filter</Button>
        </form>
        <ActionForm action={triageExceptionAction} className="space-y-0">
          <input type="hidden" name="engagement_id" value={id} />
          {triage ? (
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3 text-xs">
              <span className="font-medium">Selected:</span>
              <Select name="status" defaultValue="" className="h-8 w-40 text-xs"><option value="">— status —</option><option value="under_investigation">Under investigation</option><option value="explained">Explained</option><option value="not_an_issue">Not an issue</option><option value="open">Re-open</option></Select>
              <Select name="classification" defaultValue="" className="h-8 w-48 text-xs"><option value="">— classification —</option>{["confirmed", "probable", "requires_investigation", "documentary_deficiency", "potential_opportunity", "not_applicable", "resolved"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</Select>
              <Select name="assigned_to" defaultValue="" className="h-8 w-40 text-xs"><option value="">— assign —</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>
              <Input name="resolution_note" placeholder="Explanation (required to close)" className="h-8 w-64 text-xs" />
              <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white">Apply</button>
              <button name="op" value="observation" className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent">Draft one observation from selected</button>
            </div>) : null}
          <Table>
            <THead><TR>{triage ? <TH /> : null}<TH>Risk</TH><TH>Exception</TH><TH>Document</TH><TH>Counterparty</TH><TH>Period</TH><TH className="text-right">Taxable diff.</TH><TH className="text-right">Tax diff.</TH><TH>Classification</TH><TH>Status</TH></TR></THead>
            <TBody>{d.rows.length === 0 ? <Empty colSpan={10}>No exceptions in this view. Run the reconciliations after committing data.</Empty> : d.rows.map((x) => (
              <TR key={x.id}>
                {triage ? <TD><input type="checkbox" name="ids[]" value={x.id} className="h-4 w-4" aria-label="select" /></TD> : null}
                <TD><RiskBadge risk={x.severity} /></TD>
                <TD className="max-w-md"><Link href={`/engagements/${id}/exceptions/${x.id}`} className="font-medium text-hira-800 hover:underline">{x.exception_type.replace(/_/g, " ")}</Link>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{x.description}</div>
                  <div className="text-[10px] text-muted-foreground">Module {x.module}{x.control_id ? ` · ${x.control_id}` : ""}{x.our_gstin ? ` · ${x.our_gstin}` : ""}</div></TD>
                <TD className="text-xs">{x.doc_no ?? "—"}<div className="text-muted-foreground">{fmtDate(x.doc_date)}</div></TD>
                <TD className="text-xs">{x.counterparty_name ?? ""}<div className="font-mono text-[10px]">{x.counterparty_gstin ?? ""}</div></TD>
                <TD className="text-xs">{fmtPeriod(x.period)}</TD>
                <TD className="num">{inr(x.diff_taxable, { decimals: 0 })}</TD><TD className="num font-medium">{inr(x.diff_tax, { decimals: 0 })}</TD>
                <TD className="text-xs">{x.classification?.replace(/_/g, " ") ?? "—"}{x.assignee ? <div className="text-muted-foreground">{x.assignee}</div> : null}</TD>
                <TD><StatusBadge status={x.status} />{x.observation_id ? <div><Badge variant="secondary">Obs.</Badge></div> : null}</TD>
              </TR>))}
            </TBody>
          </Table>
        </ActionForm>
        <Pager page={page} pageSize={PAGE} total={d.agg.n} href={(p) => qs({ page: String(p) })} />
      </Section>
    </div>
  );
}
