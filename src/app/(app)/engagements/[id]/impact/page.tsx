import { Fragment } from "react";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { summariseImpact, type ImpactObs } from "@/lib/impact";
import { formatINR, toPaise, taxAtRate } from "@/lib/gst/money";
import { interestS50, demandLimitation, potentialPenalty, capitalGoodsDisposalTax, yearEndCutoff, appealTerms, gstr3bDueDate } from "@/lib/rules/statutory";
import { fmtDate, todayIso } from "@/lib/gst/dates";
import { Section } from "@/components/app/page-header";
import { ImpactTable } from "@/components/app/impact-table";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SP = Record<string, string | undefined>;
const R = (p: number) => `₹${formatINR(p)}`;

export default async function ImpactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const scope = sp.scope ?? "approved";
  const obs = await withUser(user.id, (tx) => tx<ImpactObs[]>`select * from public.audit_observations where engagement_id = ${id}
    and ${scope === "all" ? tx`status not in ('closed')` : tx`status in ('approved','shared_with_client','client_responded','final','resolved')`}`);
  const s = summariseImpact(obs);
  const calc = sp.calc;
  let result: React.ReactNode = null;
  try {
    if (calc === "interest" && sp.amount && sp.from) {
      const r = interestS50({ amount: toPaise(sp.amount), from: sp.from, to: sp.to || todayIso(), provision: (sp.provision as "50(1)" | "50(3)") ?? "50(1)" });
      result = <Result rows={[["Interest", R(r.interest)], ["Days", String(r.days)], ["Basis", r.basis]]} notes={r.notes} />;
    } else if (calc === "period" && sp.period && sp.amount) {
      const due = gstr3bDueDate(sp.period + "-01");
      const r = interestS50({ amount: toPaise(sp.amount), from: due, to: sp.to || todayIso(), provision: "50(1)" });
      result = <Result rows={[["GSTR-3B due date", fmtDate(due)], ["Interest", R(r.interest)], ["Days", String(r.days)]]} notes={r.notes} />;
    } else if (calc === "limitation" && sp.fy) {
      const r = demandLimitation(sp.fy, sp.fraud === "1");
      const pen = sp.tax ? potentialPenalty(r.regime, sp.fraud === "1", toPaise(sp.tax)) : null;
      result = <Result rows={[["Provision", r.basis], ["Annual return due", fmtDate(r.annualReturnDue)], ["Notice to be issued by", fmtDate(r.scnBy)], ["Order by", fmtDate(r.orderBy)],
        ...(pen ? [["Potential penalty", `${R(pen.penalty)} — ${pen.basis}`] as [string, string]] : [])]} notes={[...r.notes, ...(pen?.notes ?? [])]} review={r.legalReviewRequired || !!pen} />;
    } else if (calc === "cutoff" && sp.docdate) {
      const r = yearEndCutoff(sp.docdate, sp.ar || null);
      result = <Result rows={[["Cut-off (ITC s.16(4) / credit note s.34(2) / amendment s.37(3))", fmtDate(r.date)], ["Basis", r.basis]]} notes={r.notes} review={r.legalReviewRequired} />;
    } else if (calc === "s186" && sp.itc && sp.cap && sp.disp) {
      const r = capitalGoodsDisposalTax(toPaise(sp.itc), sp.cap, sp.disp, taxAtRate(toPaise(sp.value || "0"), Number(sp.rate || 18)));
      result = <Result rows={[["ITC-based (5% per quarter)", R(r.itcBased)], ["Quarters", String(r.quarters)], ["On transaction value", R(r.transactionBased)], ["Payable (higher)", R(r.payable)]]} notes={r.notes} />;
    } else if (calc === "appeal" && sp.order) {
      const r = appealTerms((sp.forum as "APL-01" | "GSTAT") ?? "APL-01", sp.order, toPaise(sp.disputed || "0"));
      result = <Result rows={[["File appeal by", fmtDate(r.appealBy)], ["Condonable up to", fmtDate(r.condonableTo)], ["Pre-deposit", R(r.preDeposit)], ["Basis", r.basis]]} notes={r.notes} review />;
    } else if (calc === "tax" && sp.value) {
      result = <Result rows={[["Tax", R(taxAtRate(toPaise(sp.value), Number(sp.rate || 18)))]]} />;
    }
  } catch (e) { result = <p className="text-sm text-destructive">{e instanceof Error ? e.message : String(e)}</p>; }
  const form = (c: string, title: string, fields: React.ReactNode) => (
    <form className="space-y-3 rounded-md border p-4">
      <input type="hidden" name="calc" value={c} /><input type="hidden" name="scope" value={scope} />
      <p className="text-sm font-semibold">{title}</p><div className="grid gap-3 sm:grid-cols-2">{fields}</div>
      <Button size="sm" variant="outline">Calculate</Button>
      {calc === c ? result : null}
    </form>
  );
  return (
    <div className="space-y-6">
      <Section title="Financial impact at a glance" description="Built only from observations in the selected scope. Unquantified items are listed, never added; recoverable balances are not netted against tax."
        actions={<form className="flex gap-2"><Select name="scope" defaultValue={scope} className="h-8 text-xs"><option value="approved">Approved observations</option><option value="all">All observations (incl. drafts)</option></Select><Button size="sm" variant="outline">Show</Button></form>}>
        <div className="p-4"><ImpactTable s={s} hrefBase={`/engagements/${id}/observations`} /></div>
      </Section>
      <Section title="Financial impact calculator" description="Deterministic calculators using the engagement's pinned rules. Results are indicative and require professional review.">
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          {form("interest", "Interest — Section 50", <>
            <Field label="Amount (₹)"><Input name="amount" defaultValue={sp.amount} /></Field>
            <Field label="Provision"><Select name="provision" defaultValue={sp.provision ?? "50(1)"}><option value="50(1)">50(1) — tax paid late</option><option value="50(3)">50(3) — ITC wrongly availed and utilised</option></Select></Field>
            <Field label="Due date (interest from)"><Input name="from" type="date" defaultValue={sp.from} /></Field>
            <Field label="Payment / computation date"><Input name="to" type="date" defaultValue={sp.to ?? todayIso()} /></Field></>)}
          {form("period", "Interest from a return period", <>
            <Field label="Return period"><Input name="period" type="month" defaultValue={sp.period} /></Field>
            <Field label="Tax (₹)"><Input name="amount" defaultValue={sp.amount} /></Field>
            <Field label="Payment date"><Input name="to" type="date" defaultValue={sp.to ?? todayIso()} /></Field></>)}
          {form("limitation", "Demand limitation and potential penalty (73 / 74 / 74A)", <>
            <Field label="Financial year"><Input name="fy" placeholder="2024-25" defaultValue={sp.fy} /></Field>
            <Field label="Tax (₹, optional)"><Input name="tax" defaultValue={sp.tax} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fraud" value="1" defaultChecked={sp.fraud === "1"} />Fraud / wilful misstatement / suppression</label></>)}
          {form("cutoff", "Year-end cut-off (16(4), 34(2), 37(3))", <>
            <Field label="Invoice / original document date"><Input name="docdate" type="date" defaultValue={sp.docdate} /></Field>
            <Field label="Annual return filed on (if earlier)"><Input name="ar" type="date" defaultValue={sp.ar} /></Field></>)}
          {form("s186", "Disposal of capital goods — Section 18(6) / Rule 44(6)", <>
            <Field label="ITC availed (₹)"><Input name="itc" defaultValue={sp.itc} /></Field>
            <Field label="Sale value (₹)"><Input name="value" defaultValue={sp.value} /></Field>
            <Field label="Capitalised on"><Input name="cap" type="date" defaultValue={sp.cap} /></Field>
            <Field label="Disposed on"><Input name="disp" type="date" defaultValue={sp.disp} /></Field>
            <Field label="Rate %"><Input name="rate" defaultValue={sp.rate ?? "18"} /></Field></>)}
          {form("appeal", "Appeal deadline and pre-deposit", <>
            <Field label="Forum"><Select name="forum" defaultValue={sp.forum ?? "APL-01"}><option value="APL-01">First appeal (Sec. 107)</option><option value="GSTAT">GSTAT (Sec. 112)</option></Select></Field>
            <Field label="Order communicated on"><Input name="order" type="date" defaultValue={sp.order} /></Field>
            <Field label="Disputed tax (₹)"><Input name="disputed" defaultValue={sp.disputed} /></Field></>)}
          {form("tax", "Tax at rate", <>
            <Field label="Taxable value (₹)"><Input name="value" defaultValue={sp.value} /></Field>
            <Field label="Rate %"><Input name="rate" defaultValue={sp.rate ?? "18"} /></Field></>)}
        </div>
      </Section>
    </div>
  );
}

function Result({ rows, notes = [], review }: { rows: [string, string][]; notes?: string[]; review?: boolean }) {
  return (
    <div className="rounded-md bg-accent/60 p-3 text-sm">
      {review ? <Badge variant="medium" className="mb-2">Legal Review Required</Badge> : null}
      <dl className="grid grid-cols-2 gap-1">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></Fragment>)}</dl>
      {notes.map((n, i) => <p key={i} className="mt-1 text-xs text-muted-foreground">• {n}</p>)}
    </div>
  );
}
