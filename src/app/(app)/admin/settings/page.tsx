import Image from "next/image";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Textarea } from "@/components/ui/input";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "System settings" };

export default async function SettingsPage() {
  const admin = await requirePermission("settings.manage");
  const s = await getSettings(admin.orgId);
  const e = env();
  return (
    <>
      <PageHeader title="System settings" description="Branding, report footer and disclaimers, security policy and AI assistance." />
      <ActionForm action={saveSettingsAction} submitLabel="Save settings" className="space-y-6">
        <Section title="Branding">
          <div className="grid gap-4 p-5 md:grid-cols-4">
            <div className="md:row-span-2"><Image src={s.brand.logoPath} alt="Logo" width={180} height={119} className="h-auto w-40 rounded border bg-white p-2" /></div>
            <Field label="Firm name"><Input name="firmName" defaultValue={s.brand.firmName} /></Field>
            <Field label="Tagline"><Input name="tagline" defaultValue={s.brand.tagline} /></Field>
            <Field label="Logo path" hint="File under /public (e.g. /brand/hira-logo.png)"><Input name="logoPath" defaultValue={s.brand.logoPath} /></Field>
            <Field label="Primary colour"><Input name="primary" type="color" defaultValue={s.brand.primary} className="h-9 w-20 p-1" /></Field>
            <Field label="Secondary colour"><Input name="secondary" type="color" defaultValue={s.brand.secondary} className="h-9 w-20 p-1" /></Field>
          </div>
        </Section>
        <Section title="Report footer, signatory and disclaimers">
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Footer line 1"><Input name="footerLine1" defaultValue={s.report.footerLine1} /></Field>
            <Field label="Footer line 2"><Input name="footerLine2" defaultValue={s.report.footerLine2} /></Field>
            <Field label="Website"><Input name="website" defaultValue={s.report.website} /></Field>
            <Field label="Address"><Input name="address" defaultValue={s.report.address} /></Field>
            <Field label="Signatory"><Input name="signatory" defaultValue={s.report.signatory} /></Field>
            <Field label="Signatory title"><Input name="signatoryTitle" defaultValue={s.report.signatoryTitle} /></Field>
            <Field label="Confidentiality statement" hint="{{client}} is replaced with the client name" className="md:col-span-2"><Textarea name="confidentiality" rows={2} defaultValue={s.report.confidentiality} /></Field>
            <Field label="Report disclaimer" className="md:col-span-2"><Textarea name="disclaimer" rows={4} defaultValue={s.report.disclaimer} /></Field>
          </div>
        </Section>
        <Section title="Security">
          <div className="grid gap-4 p-5 md:grid-cols-3">
            <Field label="Session idle timeout (minutes)" hint={`Server enforces SESSION_IDLE_MINUTES=${e.SESSION_IDLE_MINUTES}`}><Input name="sessionIdleMinutes" type="number" defaultValue={s.security.sessionIdleMinutes} /></Field>
            <Field label="Maximum upload size (MB)" hint={`Server limit MAX_UPLOAD_MB=${e.MAX_UPLOAD_MB}`}><Input name="maxUploadMb" type="number" defaultValue={s.security.maxUploadMb} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="requireMfaForAdmins" defaultChecked={s.security.requireMfaForAdmins} className="h-4 w-4" />Require MFA for administrators</label>
            <p className="text-xs text-muted-foreground md:col-span-3">Authentication provider: <b>{e.AUTH_PROVIDER}</b> · Storage: <b>{e.STORAGE_PROVIDER}</b> · Malware scanning: <b>{e.CLAMAV_HOST ? "ClamAV" : "not configured (uploads marked ‘skipped’)"}</b> · Environment: <b>{e.APP_ENV}</b></p>
          </div>
        </Section>
        <Section title="HIRA GST Intelligence (AI assistance)">
          <div className="space-y-2 p-5 text-sm">
            <p className="text-muted-foreground">Server provider: <b>{e.AI_PROVIDER === "anthropic" && e.ANTHROPIC_API_KEY ? `Anthropic (${e.AI_MODEL})` : "not configured"}</b>. AI never computes figures or introduces unverified law into a report; every AI draft requires human approval.</p>
            <label className="flex items-center gap-2"><input type="checkbox" name="aiEnabled" defaultChecked={s.ai.enabled} className="h-4 w-4" />Enable AI drafting assistance</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="aiAllowClientData" defaultChecked={s.ai.allowClientData} className="h-4 w-4" />Allow client names and GSTINs to be sent to the AI provider (otherwise they are replaced with placeholders)</label>
          </div>
        </Section>
      </ActionForm>
    </>
  );
}
