export type RoleCode = "super_admin" | "audit_manager" | "gst_auditor" | "audit_assistant" | "client_user";

export type Permission =
  | "clients.manage" | "engagements.manage" | "engagements.assign" | "users.manage" | "settings.manage"
  | "rules.approve" | "rules.propose" | "legal.approve" | "legal.propose" | "imports.manage" | "recon.run"
  | "observations.edit" | "observations.review" | "observations.approve" | "reports.generate" | "reports.approve"
  | "reports.sign" | "logs.view" | "dashboard.firm" | "controls.manage" | "actions.manage" | "requests.manage"
  | "checklist.edit" | "portal.access" | "portal.respond" | "portal.upload";

/** Mirrors public.roles.permissions (seeded in the first migration). The database remains the enforcement point via RLS. */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  super_admin: ["clients.manage","engagements.manage","engagements.assign","users.manage","settings.manage","rules.approve",
    "rules.propose","legal.approve","legal.propose","imports.manage","recon.run","observations.edit","observations.review",
    "observations.approve","reports.generate","reports.approve","reports.sign","logs.view","dashboard.firm","controls.manage",
    "actions.manage","requests.manage","checklist.edit"],
  audit_manager: ["clients.manage","engagements.manage","engagements.assign","imports.manage","recon.run","observations.edit",
    "observations.review","observations.approve","reports.generate","dashboard.firm","actions.manage","requests.manage",
    "legal.propose","rules.propose","checklist.edit"],
  gst_auditor: ["imports.manage","recon.run","observations.edit","actions.manage","requests.manage","legal.propose","checklist.edit"],
  audit_assistant: ["imports.manage","checklist.edit","requests.manage"],
  client_user: ["portal.access","portal.respond","portal.upload"],
};

export const ROLE_LABELS: Record<RoleCode, string> = {
  super_admin: "Super Administrator",
  audit_manager: "Audit Manager",
  gst_auditor: "GST Auditor",
  audit_assistant: "Audit Assistant",
  client_user: "Client User",
};

export const ROLE_RANK: Record<RoleCode, number> = {
  super_admin: 100, audit_manager: 80, gst_auditor: 60, audit_assistant: 40, client_user: 10,
};

export interface Membership { organisationId: string; role: RoleCode; clientId: string | null }

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  memberships: Membership[];
  orgId: string;               // active organisation
  role: RoleCode;              // highest role in the active organisation
  isClientUser: boolean;
  clientIds: string[];         // for client users
  mfaEnrolled: boolean;
  mfaVerified: boolean;
}

export function can(user: Pick<SessionUser, "role">, perm: Permission): boolean {
  return ROLE_PERMISSIONS[user.role]?.includes(perm) ?? false;
}

export function highestRole(ms: Membership[]): RoleCode | null {
  let best: RoleCode | null = null;
  for (const m of ms) if (!best || ROLE_RANK[m.role] > ROLE_RANK[best]) best = m.role;
  return best;
}
