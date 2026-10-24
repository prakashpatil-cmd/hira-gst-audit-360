import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { MODULES } from "@/lib/engagements";
import { fmtDate } from "@/lib/gst/dates";
import { PageHeader, Section } from "@/components/app/page-header";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD, Empty } from "@/components/ui/table";
import { Badge, RiskBadge } from "@/components/ui/badge";

export const metadata = { title: "Control library" };

export default async function ControlLibrary({ searchParams }: { searchParams: Promise<{ module?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const like = `%${sp.q ?? ""}%`;
  const rows = await withUser(user.id, (tx) => tx`select distinct on (ac.id) ac.id, ac.module, ac.category, ac.title, ac.is_active, cv.version, cv.status, cv.risk_level, cv.automation,
      cv.effective_from, cv.objective, cv.procedure, cv.law_refs, cv.required_data, cv.taxpayer_classes, cv.corrective_action, cv.exposure_basis, cv.evidence_required, cv.exception_conditions, cv.expected_result
    from public.audit_controls ac join public.control_versions cv on cv.control_id = ac.id
    where (${!sp.module} or ac.module = ${sp.module ?? ""}) and (${!sp.q} or ac.title ilike ${like} or cv.objective ilike ${like} or ac.id ilike ${like})
    order by ac.id, cv.version desc`);
  return (
    <>
      <PageHeader title="GST audit control library" description={`${rows.length} controls across modules A–Q, versioned by effective date. Changes are proposed as new versions and approved in the Rule Engine console; engagements keep the version pinned when they started.`} />
      <Section title="Controls" actions={<form className="flex gap-2"><Input name="q" defaultValue={sp.q} placeholder="Search" className="h-8 w-48 text-xs" />
        <Select name="module" defaultValue={sp.module ?? ""} className="h-8 w-56 text-xs"><option value="">All modules</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</Select>
        <Button size="sm" variant="outline">Filter</Button></form>}>
        <Table><THead><TR><TH>Control</TH><TH>Title and procedure</TH><TH>Risk</TH><TH>Applies to</TH><TH>Effective</TH><TH>Version</TH></TR></THead>
          <TBody>{rows.length === 0 ? <Empty colSpan={6}>Run the seed to load the control library.</Empty> : rows.map((r) => (
            <TR key={r.id}><TD className="font-mono text-xs">{r.id}<div className="font-sans text-muted-foreground">{MODULES[r.module]}</div></TD>
              <TD className="max-w-2xl"><details><summary className="cursor-pointer font-medium">{r.title}{r.automation ? <Badge variant="secondary" className="ml-2">Automated</Badge> : null}</summary>
                <dl className="mt-2 space-y-1 text-xs"><dt className="font-semibold">Objective</dt><dd>{r.objective}</dd><dt className="font-semibold">Procedure</dt><dd className="whitespace-pre-line">{r.procedure}</dd>
                  <dt className="font-semibold">Exception conditions</dt><dd>{r.exception_conditions}</dd><dt className="font-semibold">Exposure</dt><dd>{r.exposure_basis}</dd>
                  <dt className="font-semibold">Evidence</dt><dd>{r.evidence_required.join("; ")}</dd><dt className="font-semibold">Corrective action</dt><dd>{r.corrective_action}</dd>
                  <dt className="font-semibold">Legal basis</dt><dd className="font-mono">{r.law_refs.join(", ")}</dd><dt className="font-semibold">Data</dt><dd>{r.required_data.join(", ")}</dd></dl></details></TD>
              <TD><RiskBadge risk={r.risk_level} /></TD><TD className="text-xs">{r.taxpayer_classes.length ? r.taxpayer_classes.join(", ") : "All"}</TD>
              <TD className="text-xs">{fmtDate(r.effective_from)}</TD><TD><Badge variant={r.status === "approved" ? "secondary" : "medium"}>v{r.version} {r.status.replace(/_/g, " ")}</Badge></TD></TR>))}</TBody></Table>
      </Section>
    </>
  );
}
