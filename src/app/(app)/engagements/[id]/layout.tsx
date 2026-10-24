export const maxDuration = 300; // imports, reconciliations and report generation may run inline
import { requireUser } from "@/lib/auth/session";
import { getEngagement } from "@/lib/queries";
import { fmtDate } from "@/lib/gst/dates";
import { TabNav } from "@/components/app/nav";
import { StatusBadge } from "@/components/ui/badge";

const TABS = [
  { href: "", label: "Overview" }, { href: "/planning", label: "Planning" }, { href: "/team", label: "Team" }, { href: "/requests", label: "Document requests" },
  { href: "/imports", label: "Data import" }, { href: "/checklist", label: "Control checklist" }, { href: "/reconciliation", label: "Reconciliation" },
  { href: "/modules", label: "Audit modules" }, { href: "/exceptions", label: "Exceptions" }, { href: "/observations", label: "Observations" },
  { href: "/review", label: "Team review" }, { href: "/impact", label: "Financial impact" }, { href: "/actions", label: "Corrective actions" },
  { href: "/reports", label: "Report builder" },
];

export default async function EngagementLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await getEngagement(user, id);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{e.engagement_code} · FY {e.financial_year}</p>
          <h1 className="text-2xl font-semibold text-hira-800">{e.legal_name}</h1>
          <p className="text-sm text-muted-foreground">{e.title} · Review period {fmtDate(e.period_from)} to {fmtDate(e.period_to)} · {e.gstins.length} GSTIN(s)</p>
        </div>
        <StatusBadge status={e.status} />
      </div>
      <TabNav base={`/engagements/${id}`} items={TABS} />
      {children}
    </div>
  );
}
