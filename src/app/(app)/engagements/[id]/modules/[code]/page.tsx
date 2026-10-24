import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { inr } from "@/lib/gst/money";
import { fmtDate, fmtPeriod, addMonths, todayIso } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, RiskBadge, StatusBadge } from "@/components/ui/badge";

const RECON_FOR: Record<string, string[]> = { B: ["BOOKS_GSTR1", "GSTR1_GSTR3B"], C: ["PR_2B_3B"], D: ["SPECIAL_CHECKS"], F: ["EINV_GSTR1_BOOKS"], G: ["EWB_SALES"],
  H: ["IMPORT_EXPORT"], J: ["IMPORT_EXPORT"], L: ["SPECIAL_CHECKS"], M: ["TB_RETURNS"], N: ["TB_RETURNS"] };

export default async function ModulePage({ params }: { params: Promise<{ id: string; code: string }> }) {
  const user = await requireUser();
  const { id, code } = await params;
  if (!MODULES[code]) notFound();
  const d = await withUser(user.id, async (tx) => ({
    controls: await tx`select t.control_id, ac.title, t.status, cv.risk_level, cv.automation, t.exceptions_count from public.audit_test_results t
      join public.audit_controls ac on ac.id = t.control_id join public.control_versions cv on cv.id = t.control_version_id
      where t.engagement_id = ${id} and ac.module = ${code} order by t.control_id`,
    exTypes: await tx`select x.exception_type, x.severity, count(*)::int n, coalesce(sum(x.diff_tax),0)::text tax
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id
      where x.engagement_id = ${id} and r.is_current and x.module = ${code} and x.status in ('open','under_investigation') group by 1, 2 order by 3 desc`,
    obs: await tx`select id, obs_number, title, risk_grade, tax_amount, status from public.audit_observations where engagement_id = ${id} and module = ${code} order by obs_number`,
    exports: code === "H" ? await tx`
      with inv as (
        select s.invoice_no_norm k, min(s.invoice_no) invoice_no, min(s.invoice_date) invoice_date, sum(s.taxable_value) taxable, min(s.source_transaction_id::text) src, true in_books
        from public.sales_invoices s where s.engagement_id = ${id} and s.is_current and (s.supply_type ilike '%export%' or s.place_of_supply = '96') group by 1),
      g1 as (select doc_no_norm k, bool_or(shipping_bill_no is not null and shipping_bill_date is not null and port_code is not null) sb_in_return, min(period) period
        from public.gst_return_lines where engagement_id = ${id} and is_current and return_type = 'GSTR1' and table_code like '6A%' group by 1),
      sb as (select invoice_no_norm k, min(sb_no) sb_no, min(sb_date) sb_date, min(leo_date) leo_date, min(egm_no) egm_no, min(brc_no) brc_no, min(icegate_status) icegate
        from public.shipping_bills where engagement_id = ${id} and is_current group by 1),
      ewb as (select doc_no_norm k, count(*)::int n from public.eway_bills where engagement_id = ${id} and is_current and ewb_status = 'active' group by 1),
      einv as (select doc_no_norm k, count(*)::int n from public.einvoices where engagement_id = ${id} and is_current and irn_status = 'ACT' group by 1)
      select coalesce(inv.k, g1.k) k, inv.invoice_no, inv.invoice_date, inv.taxable, inv.in_books, g1.k is not null in_gstr1, coalesce(g1.sb_in_return,false) sb_in_return,
        sb.sb_no, sb.sb_date, sb.leo_date, sb.egm_no, sb.brc_no, sb.icegate, coalesce(ewb.n,0) ewb, coalesce(einv.n,0) einv
      from inv full join g1 on g1.k = inv.k left join sb on sb.k = coalesce(inv.k, g1.k) left join ewb on ewb.k = coalesce(inv.k, g1.k) left join einv on einv.k = coalesce(inv.k, g1.k)
      order by inv.invoice_date nulls last limit 1000` : [],
    ledgers: code === "M" ? await tx`select distinct on (l.client_gstin_id, l.source, coalesce(l.tax_head, l.ledger_name)) g.gstin, l.source, coalesce(l.tax_head, l.ledger_name) head, l.period, l.closing
      from public.ledger_balances l left join public.client_gstins g on g.id = l.client_gstin_id
      where l.engagement_id = ${id} and l.is_current and l.source in ('electronic_cash','electronic_credit')
      order by l.client_gstin_id, l.source, coalesce(l.tax_head, l.ledger_name), l.period desc` : [],
  }));
  const yes = (b: unknown) => b ? <span className="text-hira-700">✓</span> : <span className="text-red-700">✗</span>;
  const today = todayIso();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><Link href={`/engagements/${id}/modules`} className="text-xs text-muted-foreground hover:underline">← All modules</Link>
          <h2 className="text-lg font-semibold text-hira-800">Module {code} — {MODULES[code]}</h2></div>
        <div className="flex gap-3 text-sm">
          {(RECON_FOR[code] ?? []).length ? <Link className="text-primary hover:underline" href={`/engagements/${id}/reconciliation`}>Run reconciliations ({RECON_FOR[code].join(", ")})</Link> : null}
          <Link className="text-primary hover:underline" href={`/engagements/${id}/exceptions?module=${code}`}>Exceptions</Link>
          <Link className="text-primary hover:underline" href={`/engagements/${id}/checklist?module=${code}`}>Checklist</Link>
        </div>
      </div>

      {code === "H" ? (
        <Section title="Export evidence completeness tracker" description="Each export invoice must be supported by GSTR-1 Table 6A particulars, a shipping bill with LEO and EGM, e-invoice / e-way bill and realisation evidence. Rule 96A(1): export within three months of the invoice.">
          <Table><THead><TR><TH>Invoice</TH><TH>Date</TH><TH className="text-right">Taxable</TH><TH>Books</TH><TH>GSTR-1 6A</TH><TH>SB in return</TH><TH>Shipping bill</TH><TH>LEO</TH><TH>EGM</TH><TH>IRN</TH><TH>EWB</TH><TH>BRC</TH><TH>3-month test</TH></TR></THead>
            <TBody>{d.exports.length === 0 ? <Empty colSpan={13}>No export invoices found. Import the sales register (supply type “export”), GSTR-1 and shipping bills.</Empty> : d.exports.map((r) => {
              const lim = r.invoice_date ? addMonths(r.invoice_date, 3) : null;
              const met = r.leo_date ? lim && r.leo_date <= lim : null;
              const complete = r.in_books && r.in_gstr1 && r.sb_in_return && r.sb_no && r.leo_date && r.egm_no;
              return (
                <TR key={r.k}><TD className="text-xs font-medium">{r.invoice_no ?? r.k}{complete ? <Badge variant="secondary" className="ml-1">Complete</Badge> : null}</TD><TD className="text-xs">{fmtDate(r.invoice_date)}</TD>
                  <TD className="num">{inr(r.taxable, { decimals: 0 })}</TD><TD>{yes(r.in_books)}</TD><TD>{yes(r.in_gstr1)}</TD><TD>{yes(r.sb_in_return)}</TD>
                  <TD className="text-xs">{r.sb_no ? `${r.sb_no} / ${fmtDate(r.sb_date)}` : yes(false)}</TD><TD className="text-xs">{r.leo_date ? fmtDate(r.leo_date) : yes(false)}</TD>
                  <TD>{yes(r.egm_no)}</TD><TD>{yes(r.einv)}</TD><TD>{yes(r.ewb)}</TD><TD>{yes(r.brc_no)}</TD>
                  <TD className="text-xs">{met === true ? <span className="text-hira-700">Met</span> : met === false ? <span className="text-red-700">Breached</span> : lim && lim < today ? <span className="text-red-700">Not evidenced</span> : "Open"}</TD></TR>
              );
            })}</TBody></Table>
        </Section>) : null}

      {code === "M" ? (
        <Section title="Electronic ledger positions (latest balances)" description="Recoverable balances and permitted transfers (PMT-09) are kept separate from tax exposures.">
          <Table><THead><TR><TH>GSTIN</TH><TH>Ledger</TH><TH>Head</TH><TH>As at</TH><TH className="text-right">Balance</TH></TR></THead>
            <TBody>{d.ledgers.length === 0 ? <Empty colSpan={5}>Import the electronic cash and credit ledgers.</Empty> : d.ledgers.map((l, i) => (
              <TR key={i}><TD className="font-mono text-xs">{l.gstin}</TD><TD>{l.source === "electronic_cash" ? "Cash" : "Credit"}</TD><TD>{l.head}</TD><TD>{fmtPeriod(l.period)}</TD><TD className="num">₹{inr(l.closing)}</TD></TR>))}</TBody></Table>
        </Section>) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Controls">
          <Table><THead><TR><TH>Control</TH><TH>Title</TH><TH>Risk</TH><TH>Status</TH></TR></THead>
            <TBody>{d.controls.length === 0 ? <Empty colSpan={4}>No controls in this module.</Empty> : d.controls.map((c) => (
              <TR key={c.control_id}><TD><Link className="font-mono text-xs text-primary hover:underline" href={`/engagements/${id}/checklist/${c.control_id}`}>{c.control_id}</Link></TD>
                <TD className="text-sm">{c.title}{c.automation ? <Badge variant="secondary" className="ml-1">Auto</Badge> : null}</TD><TD><RiskBadge risk={c.risk_level} /></TD><TD><StatusBadge status={c.status} /></TD></TR>))}</TBody></Table>
        </Section>
        <div className="space-y-6">
          <Section title="Open exceptions by type">
            <Table><THead><TR><TH>Type</TH><TH>Risk</TH><TH className="text-right">Count</TH><TH className="text-right">Tax diff.</TH></TR></THead>
              <TBody>{d.exTypes.length === 0 ? <Empty colSpan={4}>None open.</Empty> : d.exTypes.map((x) => (
                <TR key={x.exception_type + x.severity}><TD><Link className="text-primary hover:underline" href={`/engagements/${id}/exceptions?type=${x.exception_type}`}>{x.exception_type.replace(/_/g, " ")}</Link></TD>
                  <TD><RiskBadge risk={x.severity} /></TD><TD className="num">{x.n}</TD><TD className="num">₹{inr(x.tax, { decimals: 0 })}</TD></TR>))}</TBody></Table>
          </Section>
          <Section title="Observations">
            <Table><THead><TR><TH>No.</TH><TH>Title</TH><TH>Risk</TH><TH>Status</TH></TR></THead>
              <TBody>{d.obs.length === 0 ? <Empty colSpan={4}>None.</Empty> : d.obs.map((o) => (
                <TR key={o.id}><TD>{o.obs_number}</TD><TD><Link className="text-primary hover:underline" href={`/engagements/${id}/observations/${o.id}`}>{o.title}</Link></TD>
                  <TD><RiskBadge risk={o.risk_grade} /></TD><TD><StatusBadge status={o.status} /></TD></TR>))}</TBody></Table>
          </Section>
        </div>
      </div>
    </div>
  );
}
