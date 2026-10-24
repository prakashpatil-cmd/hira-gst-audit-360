"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { run, formObject, zOptStr, zOptDate, zBool } from "@/lib/actions";
import { validateGstin, isValidPan } from "@/lib/gst/gstin";
import type { ActionState } from "@/components/app/action-form";

const clientSchema = z.object({
  legal_name: z.string().trim().min(2, "Legal name is required"),
  trade_name: zOptStr,
  pan: z.string().trim().toUpperCase().refine(isValidPan, "PAN format is invalid"),
  cin: zOptStr,
  constitution: zOptStr,
  registered_address: zOptStr,
  state_code: zOptStr,
  industry: zOptStr,
  business_activities: zOptStr,
  accounting_software: zOptStr,
  aato_crore: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nonnegative().nullable()),
  is_importer: zBool, is_exporter: zBool, is_merchant_exporter: zBool, supplies_to_sez: zBool, has_job_work: zBool,
  has_related_party_txns: zBool, has_overseas_txns: zBool, einvoice_applicable: zBool, eway_applicable: zBool, isd_applicable: zBool,
  contact_name: zOptStr, contact_designation: zOptStr, contact_email: zOptStr, contact_phone: zOptStr,
  notes: zOptStr,
});

function contactsFrom(d: z.infer<typeof clientSchema>) {
  return d.contact_name ? [{ name: d.contact_name, designation: d.contact_designation, email: d.contact_email, phone: d.contact_phone, is_primary: true }] : [];
}

export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const d = clientSchema.parse(formObject(fd));
    const id = await withUser(user.id, async (tx) => {
      const [c] = await tx<{ id: string }[]>`insert into public.clients (organisation_id, legal_name, trade_name, pan, cin, constitution, registered_address,
          state_code, industry, business_activities, accounting_software, aato_crore, is_importer, is_exporter, is_merchant_exporter, supplies_to_sez,
          has_job_work, has_related_party_txns, has_overseas_txns, einvoice_applicable, eway_applicable, isd_applicable, contacts, notes, created_by)
        values (${user.orgId}, ${d.legal_name}, ${d.trade_name}, ${d.pan}, ${d.cin}, ${d.constitution}, ${d.registered_address}, ${d.state_code},
          ${d.industry}, ${d.business_activities ? d.business_activities.split(",").map((s) => s.trim()).filter(Boolean) : []}, ${d.accounting_software},
          ${d.aato_crore}, ${d.is_importer}, ${d.is_exporter}, ${d.is_merchant_exporter}, ${d.supplies_to_sez}, ${d.has_job_work}, ${d.has_related_party_txns},
          ${d.has_overseas_txns}, ${d.einvoice_applicable}, ${d.eway_applicable}, ${d.isd_applicable}, ${tx.json(contactsFrom(d))}, ${d.notes}, ${user.id})
        returning id`;
      return c.id;
    });
    redirect(`/clients/${id}`);
  });
}

export async function updateClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const d = clientSchema.parse(formObject(fd));
    await withUser(user.id, (tx) => tx`update public.clients set legal_name = ${d.legal_name}, trade_name = ${d.trade_name}, pan = ${d.pan}, cin = ${d.cin},
        constitution = ${d.constitution}, registered_address = ${d.registered_address}, state_code = ${d.state_code}, industry = ${d.industry},
        business_activities = ${d.business_activities ? d.business_activities.split(",").map((s) => s.trim()).filter(Boolean) : []},
        accounting_software = ${d.accounting_software}, aato_crore = ${d.aato_crore}, is_importer = ${d.is_importer}, is_exporter = ${d.is_exporter},
        is_merchant_exporter = ${d.is_merchant_exporter}, supplies_to_sez = ${d.supplies_to_sez}, has_job_work = ${d.has_job_work},
        has_related_party_txns = ${d.has_related_party_txns}, has_overseas_txns = ${d.has_overseas_txns}, einvoice_applicable = ${d.einvoice_applicable},
        eway_applicable = ${d.eway_applicable}, isd_applicable = ${d.isd_applicable}, contacts = ${tx.json(contactsFrom(d))}, notes = ${d.notes}
      where id = ${id}`);
    revalidatePath(`/clients/${id}`);
    return { ok: true, message: "Client updated." };
  });
}

const gstinSchema = z.object({
  client_id: z.string().uuid(),
  gstin: z.string().trim().toUpperCase(),
  label: zOptStr,
  registration_type: z.enum(["regular", "composition", "isd", "sez_unit", "sez_developer", "casual", "nrtp", "tds", "tcs", "oidar", "uin"]),
  status: z.enum(["active", "suspended", "cancelled", "provisional"]).default("active"),
  effective_date: zOptDate,
  cancellation_date: zOptDate,
  trade_name: zOptStr,
  principal_address: zOptStr,
  jurisdiction_centre: zOptStr,
  jurisdiction_state: zOptStr,
  einvoice_applicable_from: zOptDate,
  isd_effective_from: zOptDate,
});

export async function addGstinAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const d = gstinSchema.parse(formObject(fd));
    const v = validateGstin(d.gstin);
    if (!v.valid) return { error: v.reason };
    await withUser(user.id, (tx) => tx`insert into public.client_gstins (organisation_id, client_id, gstin, state_code, label, registration_type, status,
        effective_date, cancellation_date, trade_name, principal_address, jurisdiction_centre, jurisdiction_state, einvoice_applicable_from, isd_effective_from)
      values (${user.orgId}, ${d.client_id}, ${v.gstin}, ${v.stateCode}, ${d.label}, ${d.registration_type}, ${d.status}, ${d.effective_date},
        ${d.cancellation_date}, ${d.trade_name}, ${d.principal_address}, ${d.jurisdiction_centre}, ${d.jurisdiction_state}, ${d.einvoice_applicable_from}, ${d.isd_effective_from})`);
    revalidatePath(`/clients/${d.client_id}`);
    return { ok: true, message: `GSTIN ${v.gstin} added.` };
  });
}

export async function updateGstinAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const d = gstinSchema.parse(formObject(fd));
    await withUser(user.id, (tx) => tx`update public.client_gstins set label = ${d.label}, registration_type = ${d.registration_type}, status = ${d.status},
        effective_date = ${d.effective_date}, cancellation_date = ${d.cancellation_date}, trade_name = ${d.trade_name}, principal_address = ${d.principal_address},
        jurisdiction_centre = ${d.jurisdiction_centre}, jurisdiction_state = ${d.jurisdiction_state}, einvoice_applicable_from = ${d.einvoice_applicable_from},
        isd_effective_from = ${d.isd_effective_from} where id = ${id}`);
    revalidatePath(`/clients/${d.client_id}`);
    return { ok: true, message: "Registration updated." };
  });
}

export async function addLocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const d = z.object({
      client_id: z.string().uuid(), client_gstin_id: zOptStr, name: z.string().trim().min(2),
      location_type: z.enum(["principal", "additional", "factory", "warehouse", "depot", "branch", "job_worker", "sez_unit", "ftwz", "office", "temporary"]),
      address: zOptStr, pincode: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{6}$/, "PIN code must have 6 digits").nullable()),
      is_registered_on_portal: zBool,
    }).parse(formObject(fd));
    await withUser(user.id, async (tx) => {
      let state: string | null = null;
      if (d.client_gstin_id) [{ state_code: state }] = await tx<{ state_code: string }[]>`select state_code from public.client_gstins where id = ${d.client_gstin_id}`;
      await tx`insert into public.business_locations (organisation_id, client_id, client_gstin_id, name, location_type, address, state_code, pincode, is_registered_on_portal)
        values (${user.orgId}, ${d.client_id}, ${d.client_gstin_id}, ${d.name}, ${d.location_type}, ${d.address}, ${state}, ${d.pincode}, ${d.is_registered_on_portal})`;
    });
    revalidatePath(`/clients/${d.client_id}`);
    return { ok: true, message: "Location added." };
  });
}

export async function toggleLocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("clients.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const clientId = z.string().uuid().parse(fd.get("client_id"));
    await withUser(user.id, (tx) => tx`update public.business_locations set is_active = not is_active where id = ${id}`);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  });
}
