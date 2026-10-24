import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { inr } from "@/lib/gst/money";

export default async function ModulesIndex({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const d = await withUser(user.id, async (tx) => ({
    ctrl: await tx`select ac.module, count(*) filter (where t.status <> 'not_applicable')::int applicable,
        count(*) filter (where t.status in ('passed','exception_detected','confirmed_observation','resolved','closed'))::int tested,
        count(*) filter (where t.status in ('exception_detected','confirmed_observation'))::int failed
      from public.audit_test_results t join public.audit_controls ac on ac.id = t.control_id where t.engagement_id = ${id} group by 1`,
    ex: await tx`select x.module, count(*)::int n, coalesce(sum(x.diff_tax) filter (where x.diff_tax > 0 and x.severity <> 'opportunity'),0)::text tax
      from public.reconciliation_exceptions x join public.reconciliation_runs r on r.id = x.run_id where x.engagement_id = ${id} and r.is_current and x.status in ('open','under_investigation') group by 1`,
    obs: await tx`select module, count(*)::int n from public.audit_observations where engagement_id = ${id} group by 1`,
  }));
  const by = (rows: readonly Record<string, any>[]) => new Map(rows.map((r) => [r.module as string, r])); // eslint-disable-line @typescript-eslint/no-explicit-any
  const C = by(d.ctrl), E = by(d.ex), O = by(d.obs);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Object.entries(MODULES).map(([k, v]) => {
        const c = C.get(k), e = E.get(k), o = O.get(k);
        const pct = c?.applicable ? Math.round((c.tested / c.applicable) * 100) : 0;
        return (
          <Link key={k} href={`/engagements/${id}/modules/${k}`} className="rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/60">
            <p className="text-xs font-semibold text-muted-foreground">MODULE {k}</p>
            <p className="font-semibold text-hira-800">{v}</p>
            <div className="mt-3 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${pct}%` }} /></div>
            <p className="mt-2 text-xs text-muted-foreground">{c?.tested ?? 0}/{c?.applicable ?? 0} controls tested · {c?.failed ?? 0} with exceptions</p>
            <p className="text-xs text-muted-foreground">{e?.n ?? 0} open exceptions{e && Number(e.tax) ? ` · ₹${inr(e.tax, { decimals: 0 })}` : ""} · {o?.n ?? 0} observations</p>
          </Link>
        );
      })}
    </div>
  );
}
