import Link from "next/link";
import { formatINR } from "@/lib/gst/money";
import type { ImpactSummary } from "@/lib/impact";

const SECTIONS: [keyof ImpactSummary["subtotal"], string, string][] = [
  ["A", "A. Input tax credit wrongly availed — to be reversed", "Cash outflow"],
  ["B", "B. Reverse charge and output tax not discharged", "Cash outflow"],
  ["C", "C. Output tax on inadmissible credit notes", "Cash outflow"],
  ["D", "D. Other potential statutory tax liabilities", "Cash outflow"],
];
const R = (p: number) => formatINR(p, { decimals: 0 });

/** Financial Impact at a Glance — same structure as the report. */
export function ImpactTable({ s, hrefBase }: { s: ImpactSummary; hrefBase?: string }) {
  const obsCell = (n: number, id: string) => hrefBase ? <Link className="text-primary hover:underline" href={`${hrefBase}/${id}`}>{n}</Link> : n;
  const head = <tr className="bg-hira-700 text-white"><th className="w-16 px-3 py-2 text-left">Obs.</th><th className="px-3 py-2 text-left">Basis of the figure</th><th className="w-40 px-3 py-2 text-right">Amount (₹)</th><th className="w-32 px-3 py-2 text-left">Nature</th></tr>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border text-sm">
        <thead>{head}</thead>
        <tbody>
          {SECTIONS.map(([k, label, nature]) => s[k].length ? (
            <SectionRows key={k} label={label} rows={s[k].map((l) => <tr key={l.id + k} className="border-t"><td className="px-3 py-1.5 text-center font-medium text-hira-700">{obsCell(l.obs, l.id)}</td><td className="px-3 py-1.5">{l.basis}</td><td className="px-3 py-1.5 text-right tabular-nums">{R(l.amount)}</td><td className="px-3 py-1.5">{nature}</td></tr>)}
              total={<tr className="border-t bg-muted/50 font-semibold"><td /><td className="px-3 py-1.5">Sub-total — {k}</td><td className="px-3 py-1.5 text-right tabular-nums">{R(s.subtotal[k])}</td><td /></tr>} />
          ) : null)}
          <tr className="bg-hira-700 font-semibold text-white"><td /><td className="px-3 py-2">TOTAL TAX PAYABLE (A + B + C + D)</td><td className="px-3 py-2 text-right tabular-nums">{R(s.totalTaxPayable)}</td><td className="px-3 py-2">Payable</td></tr>
          {s.E.length ? <SectionRows label="E. Less: input tax credit re-available" rows={s.E.map((l) => <tr key={l.id + "E"} className="border-t"><td className="px-3 py-1.5 text-center font-medium text-hira-700">{obsCell(l.obs, l.id)}</td><td className="px-3 py-1.5">{l.basis}</td><td className="px-3 py-1.5 text-right tabular-nums">({R(l.amount)})</td><td className="px-3 py-1.5">Recoverable</td></tr>)} /> : null}
          <tr className="bg-hira-700 font-semibold text-white"><td /><td className="px-3 py-2">NET CASH OUTFLOW BEFORE INTEREST</td><td className="px-3 py-2 text-right tabular-nums">{R(s.netCashBeforeInterest)}</td><td className="px-3 py-2">Net payable</td></tr>
          {s.F.length ? <SectionRows label="F. Contingent — pending details" rows={s.F.map((l) => <tr key={l.id + "F"} className="border-t"><td className="px-3 py-1.5 text-center font-medium text-hira-700">{obsCell(l.obs, l.id)}</td><td className="px-3 py-1.5">{l.basis}</td><td className="px-3 py-1.5 text-right tabular-nums">{R(l.amount)}</td><td className="px-3 py-1.5">Contingent</td></tr>)}
            total={<tr className="border-t bg-muted/50 font-semibold"><td /><td className="px-3 py-1.5">Sub-total — F</td><td className="px-3 py-1.5 text-right tabular-nums">{R(s.subtotal.F)}</td><td /></tr>} /> : null}
          {s.G.length + s.H.length ? <SectionRows label="G / H. Recoverable — in the company's favour" rows={[...s.G, ...s.H].map((l) => <tr key={l.id + "GH"} className="border-t text-hira-700"><td className="px-3 py-1.5 text-center font-medium">{obsCell(l.obs, l.id)}</td><td className="px-3 py-1.5">{l.basis}</td><td className="px-3 py-1.5 text-right tabular-nums">{R(l.amount)}</td><td className="px-3 py-1.5">In your favour</td></tr>)} /> : null}
          <tr className="border-t"><td /><td className="px-3 py-1.5 italic text-muted-foreground">I. Estimated interest under Section 50 (indicative, to the computation date)</td><td className="px-3 py-1.5 text-right tabular-nums">{R(s.interest)}</td><td className="px-3 py-1.5 text-muted-foreground">Additional</td></tr>
          <tr className="border-t"><td /><td className="px-3 py-1.5 italic text-muted-foreground">J. Potential penalties — disclosed separately, subject to legal conditions</td><td className="px-3 py-1.5 text-right tabular-nums">{R(s.penalty)}</td><td className="px-3 py-1.5 text-muted-foreground">Potential</td></tr>
        </tbody>
      </table>
      {s.unquantified.length ? (
        <div className="mt-3 text-sm"><p className="font-medium">Unquantified exposures (not added to any total):</p>
          <ul className="list-disc pl-5 text-muted-foreground">{s.unquantified.map((u) => <li key={u.id}>Obs. {u.obs} — {u.title}: {u.text}</li>)}</ul></div>) : null}
    </div>
  );
}

function SectionRows({ label, rows, total }: { label: string; rows: React.ReactNode[]; total?: React.ReactNode }) {
  return <>{[<tr key="h" className="border-t bg-hira-50"><td colSpan={4} className="px-3 py-1.5 font-semibold text-hira-800">{label}</td></tr>, ...rows, total]}</>;
}
