"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate } from "@/lib/actions";
import type { ActionState } from "@/components/app/action-form";

const OFFICIAL = /^https:\/\/(www\.)?(cbic-gst\.gov\.in|gst\.gov\.in|cbic\.gov\.in|egazette\.gov\.in|gstcouncil\.gov\.in|tutorial\.gst\.gov\.in|services\.gst\.gov\.in|indiacode\.nic\.in|sci\.gov\.in|main\.sci\.gov\.in)(\/|$)/i;

export async function proposeLegalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("legal.propose");
    const d = z.object({ code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9\-().]{2,60}$/, "Code: capitals, digits and hyphens"), source_type: z.enum(["act", "rule", "notification", "circular", "order", "advisory", "judgment", "council", "instruction", "other"]),
      title: z.string().trim().min(3), provision: zOptStr, statute: zOptStr, jurisdiction: z.string().default("central"), source_url: zOptStr, notification_no: zOptStr,
      publication_date: zOptDate, effective_from: zOptDate, effective_to: zOptDate, applicable_fys: zOptStr, summary: zOptStr,
      legal_status: z.enum(["proposed", "enacted_not_effective", "effective", "superseded", "omitted"]) }).parse(formObject(fd));
    if (d.source_url && !OFFICIAL.test(d.source_url)) return { error: "Source URL must be an official government source (CBIC, GST portal, e-Gazette, GST Council, India Code, Supreme Court)." };
    await withUser(user.id, (tx) => tx`insert into public.legal_references (code, source_type, title, provision, statute, jurisdiction, source_url, notification_no, publication_date,
        effective_from, effective_to, applicable_fys, summary, legal_status, verification_status, approval_status, created_by)
      values (${d.code}, ${d.source_type}, ${d.title}, ${d.provision}, ${d.statute}, ${d.jurisdiction}, ${d.source_url}, ${d.notification_no}, ${d.publication_date},
        ${d.effective_from}, ${d.effective_to}, ${d.applicable_fys ? d.applicable_fys.split(",").map((s) => s.trim()) : []}, ${d.summary}, ${d.legal_status}, 'unverified', 'pending', ${user.id})`);
    revalidatePath("/legal");
    return { ok: true, message: "Reference proposed. A Super Administrator must verify and approve it before it is treated as verified." };
  });
}

export async function reviewLegalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("legal.approve");
    const d = z.object({ id: z.string().uuid(), op: z.enum(["approve", "reject", "review_required"]), comment: zOptStr }).parse(formObject(fd));
    await withUser(user.id, async (tx) => {
      const [r] = await tx`select source_url from public.legal_references where id = ${d.id}`;
      if (d.op === "approve" && !r?.source_url) throw new Error("Record the official source URL before approving.");
      await tx`update public.legal_references set approval_status = ${d.op === "approve" ? "approved" : d.op === "reject" ? "rejected" : "pending"},
          verification_status = ${d.op === "approve" ? "verified" : "legal_review_required"},
          verified_at = case when ${d.op} = 'approve' then now() else verified_at end, verified_by = case when ${d.op} = 'approve' then ${user.id}::uuid else verified_by end,
          approved_by = case when ${d.op} = 'approve' then ${user.id}::uuid else null end, approved_at = case when ${d.op} = 'approve' then now() else null end
        where id = ${d.id}`;
      await tx`insert into public.review_approvals (organisation_id, entity_type, entity_id, action, comment, actor_id)
        values (${user.orgId}, 'legal_reference', ${d.id}, ${d.op === "approve" ? "approve" : d.op === "reject" ? "reject" : "comment"}, ${d.comment}, ${user.id})`;
    });
    revalidatePath("/legal");
    return { ok: true, message: "Updated." };
  });
}
