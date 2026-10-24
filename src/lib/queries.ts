import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/permissions";

export interface EngagementHeader {
  id: string; organisation_id: string; client_id: string; engagement_code: string; title: string; financial_year: string; period_from: string;
  period_to: string; status: string; audit_type: string; scope: string | null; exclusions: string | null; legal_name: string; pan: string;
  materiality_amount: string; tolerance_amount: string; data_request_date: string | null; completion_deadline: string | null;
  report_issue_date: string | null; audit_visits: { label: string; from: string; to: string }[]; locked_at: string | null;
  engagement_partner_id: string | null; reviewing_manager_id: string | null; my_role: string | null; is_manager: boolean;
  gstins: { id: string; gstin: string; label: string | null; state_code: string }[];
}

export const getEngagement = cache(async (user: SessionUser, id: string): Promise<EngagementHeader> => {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const e = await withUser(user.id, async (tx) => {
    const [row] = await tx<EngagementHeader[]>`select e.*, c.legal_name, c.pan,
        (select a.engagement_role from public.audit_assignments a where a.engagement_id = e.id and a.user_id = ${user.id}) my_role,
        app.is_manager_of_engagement(e.id) is_manager
      from public.audit_engagements e join public.clients c on c.id = e.client_id where e.id = ${id}`;
    if (!row) return null;
    row.gstins = await tx`select g.id, g.gstin, g.label, g.state_code from public.engagement_gstins eg join public.client_gstins g on g.id = eg.client_gstin_id
      where eg.engagement_id = ${id} order by g.gstin`;
    return row;
  });
  if (!e) notFound();
  return e;
});
