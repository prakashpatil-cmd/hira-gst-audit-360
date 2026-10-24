"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr } from "@/lib/actions";
import { createImport, updateMapping, queueValidation, queueCommit } from "@/lib/import/service";
import { createSignedUpload, objectStore, safeFileName } from "@/lib/storage";
import { kickJob } from "@/lib/jobs/kick";
import { getDataset } from "@/lib/import/datasets";
import type { ActionState } from "@/components/app/action-form";

export async function prepareUploadAction(engagementId: string, fileName: string): Promise<{ key: string; url: string; token: string } | null> {
  const user = await requirePermission("imports.manage");
  const [e] = await withUser(user.id, (tx) => tx<{ client_id: string }[]>`select client_id from public.audit_engagements where id = ${engagementId}`);
  if (!e) throw new Error("Engagement not found");
  return createSignedUpload(`${user.orgId}/${e.client_id}/${engagementId}/staging/${randomUUID()}-${safeFileName(fileName)}`);
}

export async function uploadImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("imports.manage");
    const o = formObject(fd);
    const d = z.object({ engagement_id: z.string().uuid(), client_gstin_id: zOptStr, dataset_type: z.string().min(2), stored_key: zOptStr, file_name: zOptStr }).parse(o);
    const dataset = getDataset(d.dataset_type);
    let body: Buffer, name: string;
    if (d.stored_key) {
      body = await objectStore().get(d.stored_key);
      name = d.file_name ?? d.stored_key.split("/").pop()!;
    } else {
      const f = fd.get("file");
      if (!(f instanceof File) || f.size === 0) return { error: "Choose a file to upload." };
      body = Buffer.from(await f.arrayBuffer()); name = f.name;
    }
    const importId = await createImport(user, { engagementId: d.engagement_id, clientGstinId: dataset.perGstin ? d.client_gstin_id : (d.client_gstin_id ?? null),
      datasetType: d.dataset_type, fileName: name, body, preUploadedKey: d.stored_key ?? undefined });
    redirect(`/engagements/${d.engagement_id}/imports/${importId}`);
  });
}

export async function saveMappingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("imports.manage");
    const o = formObject(fd);
    const importId = z.string().uuid().parse(o.import_id);
    const columnMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (k.startsWith("map:") && typeof v === "string" && v) columnMap[k.slice(4)] = v;
    const opts = z.object({
      date_order: z.enum(["DMY", "MDY", "YMD"]).default("DMY"), negative_cn: z.boolean().optional(), default_period: zOptStr,
      mode: z.enum(["replace", "append"]).default("replace"), sheet: zOptStr, header_row: z.coerce.number().int().min(1).max(200).optional(), template_name: zOptStr,
    }).parse({ ...o, negative_cn: o.negative_cn === true });
    await updateMapping(user, importId, { sheet: opts.sheet, headerRow: opts.header_row, columnMap,
      options: { dateOrder: opts.date_order, negativeAsCreditNote: !!opts.negative_cn, defaultPeriod: opts.default_period ? `${opts.default_period}-01`.slice(0, 10) : null, mode: opts.mode },
      saveTemplateAs: opts.template_name });
    revalidatePath(`/engagements/${o.engagement_id}/imports/${importId}`);
    return { ok: true, message: opts.template_name ? `Mapping saved and stored as template "${opts.template_name}".` : "Mapping saved." };
  });
}

export async function validateImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("imports.manage");
    const importId = z.string().uuid().parse(fd.get("import_id"));
    const jobId = await queueValidation(user, importId);
    await kickJob(jobId);
    revalidatePath(`/engagements/${fd.get("engagement_id")}/imports/${importId}`);
    return { ok: true, message: "Validation started." };
  });
}

export async function commitImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("imports.manage");
    const importId = z.string().uuid().parse(fd.get("import_id"));
    const jobId = await queueCommit(user, importId);
    await kickJob(jobId);
    revalidatePath(`/engagements/${fd.get("engagement_id")}/imports`);
    return { ok: true, message: "Commit started." };
  });
}

export async function discardImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("imports.manage");
    const importId = z.string().uuid().parse(fd.get("import_id"));
    const r = await withUser(user.id, (tx) => tx`update public.data_imports set status = 'discarded' where id = ${importId} and status in ('uploaded','mapped','validated','failed')`);
    if (!r.count) return { error: "Only uncommitted imports can be discarded." };
    redirect(`/engagements/${fd.get("engagement_id")}/imports`);
  });
}
