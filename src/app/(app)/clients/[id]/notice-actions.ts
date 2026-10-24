"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate, zMoney } from "@/lib/actions";
import { appealTerms } from "@/lib/rules/statutory";
import { toPaise, paiseToDecimal } from "@/lib/gst/money";
import type { ActionState } from "@/components/app/action-form";

export async function addNoticeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser();
    const d = z.object({
      client_id: z.string().uuid(), client_gstin_id: zOptStr, engagement_id: zOptStr,
      form_type: z.enum(["ASMT-10", "ASMT-11", "ASMT-12", "ADT-01", "ADT-02", "DRC-01A", "DRC-01", "DRC-03", "DRC-06", "DRC-07", "APL-01", "APL-02", "GSTAT", "RFD-08", "RFD-09", "RFD-06", "OTHER"]),
      reference_no: zOptStr, subject: zOptStr, section: zOptStr, issue_date: zOptDate, period_from: zOptDate, period_to: zOptDate,
      demand_tax: zMoney, demand_interest: zMoney, demand_penalty: zMoney, response_due: zOptDate, hearing_date: zOptDate, order_date: zOptDate,
      amount_paid: zMoney, notes: zOptStr,
    }).parse(formObject(fd));
    // Orders (DRC-07 / APL-04-type outcomes) carry an appeal clock: compute it rather than ask for it.
    let appealDue: string | null = null, preDeposit = "0";
    if (d.order_date && ["DRC-07", "APL-02"].includes(d.form_type)) {
      const t = appealTerms(d.form_type === "DRC-07" ? "APL-01" : "GSTAT", d.order_date, toPaise(d.demand_tax));
      appealDue = t.appealBy; preDeposit = paiseToDecimal(t.preDeposit);
    }
    await withUser(user.id, (tx) => tx`insert into public.notices (organisation_id, client_id, client_gstin_id, engagement_id, form_type, reference_no, subject, section,
        issue_date, period_from, period_to, demand_tax, demand_interest, demand_penalty, response_due, hearing_date, order_date, appeal_due, pre_deposit, amount_paid,
        status, notes, created_by)
      values (${user.orgId}, ${d.client_id}, ${d.client_gstin_id}, ${d.engagement_id}, ${d.form_type}, ${d.reference_no}, ${d.subject}, ${d.section},
        ${d.issue_date}, ${d.period_from}, ${d.period_to}, ${d.demand_tax}, ${d.demand_interest}, ${d.demand_penalty}, ${d.response_due}, ${d.hearing_date},
        ${d.order_date}, ${appealDue}, ${preDeposit}, ${d.amount_paid}, ${d.order_date ? "order_passed" : "open"}, ${d.notes}, ${user.id})`);
    revalidatePath(`/clients/${d.client_id}`);
    return { ok: true, message: appealDue ? `Notice recorded. Appeal to be filed by ${appealDue} (verify against the date of communication).` : "Notice recorded." };
  });
}
