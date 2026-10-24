import { requirePermission } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { fmtDateTime } from "@/lib/gst/dates";
import { PageHeader, Section } from "@/components/app/page-header";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createUserAction, updateUserAction } from "../actions";

export const metadata = { title: "User administration" };

export default async function UsersPage() {
  const admin = await requirePermission("users.manage");
  const { users, clients } = await withUser(admin.id, async (tx) => ({
    users: await tx`select u.*, m.role_code, c.legal_name client from public.users u join public.memberships m on m.user_id = u.id and m.organisation_id = ${admin.orgId}
      left join public.clients c on c.id = m.client_id order by (m.role_code = 'client_user'), u.full_name`,
    clients: await tx`select id, legal_name from public.clients order by legal_name`,
  }));
  return (
    <>
      <PageHeader title="User administration" description="Roles: Super Administrator, Audit Manager, GST Auditor, Audit Assistant and Client User. Client users see only their own organisation." />
      <Section title={`${users.length} user(s)`}>
        <Table><THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>MFA</TH><TH>Last sign-in</TH><TH>Manage</TH></TR></THead>
          <TBody>{users.map((u) => (
            <TR key={u.id}>
              <TD><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted-foreground">{u.email}{u.designation ? ` · ${u.designation}` : ""}</div></TD>
              <TD>{ROLE_LABELS[u.role_code as keyof typeof ROLE_LABELS]}{u.client ? <div className="text-xs text-muted-foreground">{u.client}</div> : null}</TD>
              <TD>{u.is_active ? <Badge variant="secondary">Active</Badge> : <Badge variant="high">Disabled</Badge>}</TD>
              <TD>{u.mfa_enforced ? <Badge variant="secondary">Required</Badge> : <Badge variant="muted">Optional</Badge>}</TD>
              <TD className="text-xs">{u.last_login_at ? fmtDateTime(u.last_login_at) : "Never"}</TD>
              <TD>
                <ActionForm action={updateUserAction} inline className="flex-wrap">
                  <input type="hidden" name="user_id" value={u.id} />
                  <Select name="op" className="h-8 w-40 text-xs" defaultValue={u.is_active ? "deactivate" : "activate"}>
                    <option value="activate">Activate</option><option value="deactivate">Deactivate</option><option value="role">Change role to…</option>
                    <option value="reset">Reset password to…</option><option value="mfa_on">Require MFA</option><option value="mfa_off">Make MFA optional</option><option value="revoke_sessions">Sign out everywhere</option>
                  </Select>
                  <Select name="role" className="h-8 w-36 text-xs" defaultValue={u.role_code}>{Object.entries(ROLE_LABELS).filter(([k]) => k !== "client_user").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  <Input name="password" type="password" placeholder="Temporary password" className="h-8 w-36 text-xs" autoComplete="new-password" />
                  <button className="rounded border px-2 py-1 text-xs hover:bg-muted">Apply</button>
                </ActionForm>
              </TD>
            </TR>))}</TBody></Table>
      </Section>
      <div className="mt-6"><Section title="Create a user">
        <ActionForm action={createUserAction} submitLabel="Create user" resetOnSuccess className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Full name"><Input name="full_name" required /></Field>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Designation"><Input name="designation" /></Field>
            <Field label="Role"><Select name="role" defaultValue="gst_auditor">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Client (client users only)"><Select name="client_id" defaultValue=""><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</Select></Field>
            <Field label="Temporary password" hint="10+ characters, upper/lower case, digit and symbol"><Input name="password" type="password" required autoComplete="new-password" /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="mfa_enforced" className="h-4 w-4" />Require MFA</label>
          </div>
        </ActionForm>
      </Section></div>
    </>
  );
}
