import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { withUser } from "@/lib/db";
import { RECON_TYPES, type ReconType } from "@/lib/recon/runner";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtDateTime, fmtPeriod } from "@/lib/gst/dates";
import { Section, Stat, Pager } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { approveMatchAction } from "../actions";

const PAGE = 100;
const SIDES: Record<string, [string, string]> = {
  BOOKS_GSTR1: ["Books", "GSTR-1"], GSTR1_GSTR3B: ["GSTR-1", "GSTR-3B"], PR_2B_3B: ["Purchase register", "GSTR-2B"], EINV_GSTR1_BOOKS: ["E-invoice", "GSTR-1 / books"],
  EWB_SALES: ["E-way bill", "Sales register"], IMPORT_EXPORT: ["A", "B"], TB_RETURNS: ["Books", "Returns"], SPECIAL_CHECKS: ["", ""],
};

export default async function RunDetail({ params, searchParams }: { params: Promise<{ id: string; runId: string }>; searchParams: Promise<{ status?: string; page?: string; q?: string }> }) {
  const user = await requireUser();
  const { id, runId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const data = await withUser(user.id, async (tx) => {
    const [run] = await tx`select r.*, u.full_name from public.reconciliation_runs r left join public.users u on u.id = r.created_by where r.id = ${runId} and r.engagement_id = ${id}`;
    if (!run) return null;
    const filt = tx`${sp.status ? tx`and m.match_status = ${sp.status}` : tx``} ${sp.q ? tx`and (m.doc_no ilike ${"%" + sp.q + "%"} or m.counterparty_gstin ilike ${"%" + sp.q + "%"})` : tx``}`;
    const rows = await tx`select m.*, (select count(*)::int from public.reconciliation_exceptions x where x.match_id = m.id) ex,
        (select x.id from public.reconciliation_exceptions x where x.match_id = m.id limit 1) ex_id, u.full_name approver
      from public.reconciliation_matches m left join public.users u on u.id = m.approved_by
      where m.run_id = ${runId} ${filt} order by (m.match_status like 'matched%'), m.period nulls last, m.match_key limit ${PAGE} offset ${(page - 1) * PAGE}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.reconciliation_matches m where m.run_id = ${runId} ${filt}`;
    return { run, rows, n };
  });
  if (!data) notFound();
  const { run } = data;
  const mc = (run.summary?.matchCounts ?? {}) as Record<string, number>;
  const [L, R] = SIDES[run.recon_type] ?? ["Left", "Right"];
  const base = `/engagements/${id}/reconciliation/${runId}`;
  const canRun = can(user, "recon.run");
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/engagements/${id}/reconciliation`} className="text-xs text-muted-foreground hover:underline">← Reconciliations</Link>
        <h2 className="text-lg font-semibold text-hira-800">{RECON_TYPES[run.recon_type as ReconType]?.label}</h2>
        <p className="text-sm text-muted-foreground">Run {fmtDateTime(run.completed_at ?? run.created_at)} by {run.full_name} · engine {run.engine_version} ·
          input hash <span className="font-mono text-xs">{run.input_hash?.slice(0, 12) ?? "—"}</span> · {run.input_import_ids.length} import(s) {run.is_current ? <Badge variant="secondary">current</Badge> : <Badge variant="muted">superseded</Badge>}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(mc).sort().map(([s, n]) => <Stat key={s} label={s.replace(/_/g, " ")} value={n} href={`${base}?status=${s}`} tone={s.startsWith("matched") ? "good" : "danger"} />)}
        <Stat label="Exceptions raised" value={run.summary?.exceptions ?? 0} href={`/engagements/${id}/exceptions?run=${runId}`} />
      </div>
      {run.recon_type === "PR_2B_3B" && Array.isArray(run.summary?.registrations) ? (
        <Section title="ITC by period — books vs GSTR-2B vs GSTR-3B Table 4(A)">
          <Table><THead><TR><TH>Period</TH><TH className="text-right">ITC per books</TH><TH className="text-right">Available per GSTR-2B</TH><TH className="text-right">GSTR-3B 4(A) total</TH><TH className="text-right">of which 4(A)(5)</TH></TR></THead>
            <TBody>{(run.summary.registrations as { periods?: { period: string; books: number; twoB: number; t4a: number; t4a5: number }[] }[]).flatMap((g) => g.periods ?? []).map((p, i) => (
              <TR key={i}><TD>{fmtPeriod(p.period)}</TD><TD className="num">{inr(p.books / 100)}</TD><TD className="num">{inr(p.twoB / 100)}</TD><TD className="num">{inr(p.t4a / 100)}</TD><TD className="num">{inr(p.t4a5 / 100)}</TD></TR>))}</TBody></Table>
        </Section>
      ) : null}
      <Section title="Matching results" actions={
        <form className="flex gap-2"><input type="hidden" name="status" value={sp.status ?? ""} /><Input name="q" defaultValue={sp.q ?? ""} placeholder="Document or GSTIN" className="h-8 w-52 text-xs" /><Button size="sm" variant="outline">Search</Button>
          {sp.status || sp.q ? <Link href={base} className="self-center text-xs text-primary hover:underline">Clear</Link> : null}</form>}>
        <Table>
          <THead><TR><TH>Status</TH><TH>Document / key</TH><TH>Date</TH><TH>Counterparty</TH><TH className="text-right">{L} taxable</TH><TH className="text-right">{L} tax</TH>
            <TH className="text-right">{R} taxable</TH><TH className="text-right">{R} tax</TH><TH className="text-right">Tax diff.</TH><TH>Follow-up</TH></TR></THead>
          <TBody>{data.rows.length === 0 ? <Empty colSpan={10}>No results in this view.</Empty> : data.rows.map((m) => (
            <TR key={m.id}>
              <TD><StatusBadge status={m.match_status} /><div className="text-[10px] text-muted-foreground">{m.match_method}{(m.diff?.flags ?? []).length ? ` · ${m.diff.flags.join(", ")}` : ""}</div></TD>
              <TD className="text-xs">{m.doc_no ?? m.match_key}</TD><TD className="text-xs">{m.doc_date ? fmtDate(m.doc_date) : fmtPeriod(m.period)}</TD>
              <TD className="font-mono text-[11px]">{m.counterparty_gstin ?? "—"}</TD>
              <TD className="num">{inr(m.left_values?.taxable)}</TD><TD className="num">{inr(m.left_values?.tax)}</TD>
              <TD className="num">{inr(m.right_values?.taxable)}</TD><TD className="num">{inr(m.right_values?.tax)}</TD>
              <TD className={`num ${Number(m.diff?.tax ?? 0) !== 0 ? "font-medium text-red-700" : ""}`}>{inr(m.diff?.tax)}</TD>
              <TD className="text-xs">
                {m.ex_id ? <Link className="text-primary hover:underline" href={`/engagements/${id}/exceptions/${m.ex_id}`}>{m.ex} exception(s)</Link> : null}
                {m.is_manual ? <div className="text-hira-700">Reconciled manually by {m.approver}: {m.note}</div> : null}
                {canRun && !m.is_manual && !m.match_status.startsWith("matched") && run.is_current ? (
                  <ActionForm action={approveMatchAction} inline>
                    <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="match_id" value={m.id} />
                    <Input name="note" placeholder="Reason reconciled" className="h-7 w-36 text-xs" /><button className="rounded border px-2 py-0.5 text-xs hover:bg-muted">Approve</button>
                  </ActionForm>) : null}
              </TD>
            </TR>))}
          </TBody>
        </Table>
        <Pager page={page} pageSize={PAGE} total={data.n} href={(p) => `${base}?page=${p}${sp.status ? `&status=${sp.status}` : ""}${sp.q ? `&q=${sp.q}` : ""}`} />
      </Section>
    </div>
  );
}
