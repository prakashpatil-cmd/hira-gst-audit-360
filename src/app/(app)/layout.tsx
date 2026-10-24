import Image from "next/image";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { SideNav, type NavGroup } from "@/components/app/nav";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const groups: NavGroup[] = [
    { label: "Audit", items: [
      { href: "/dashboard", label: "Firm dashboard", icon: "LayoutDashboard" },
      { href: "/clients", label: "Client master", icon: "Building2" },
      { href: "/engagements", label: "Engagements", icon: "ClipboardList" },
      { href: "/actions", label: "Corrective actions", icon: "ListChecks" },
      { href: "/reports", label: "Report archive", icon: "FileArchive" },
    ] },
    { label: "Knowledge", items: [
      { href: "/legal", label: "Legal research library", icon: "Scale" },
      { href: "/library", label: "Observation library", icon: "Library" },
      { href: "/controls", label: "Control library", icon: "BookOpen" },
    ] },
  ];
  const admin: NavGroup["items"] = [];
  if (can(user, "users.manage")) admin.push({ href: "/admin/users", label: "User administration", icon: "Users" });
  if (can(user, "settings.manage")) admin.push({ href: "/admin/settings", label: "System settings", icon: "Settings" });
  if (can(user, "rules.approve") || can(user, "rules.propose")) admin.push({ href: "/admin/rules", label: "Rule engine", icon: "ScrollText" });
  if (can(user, "logs.view")) admin.push({ href: "/admin/logs", label: "Security & audit logs", icon: "ShieldCheck" });
  if (admin.length) groups.push({ label: "Administration", items: admin });

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-hira-800 md:flex">
        <Link href="/dashboard" className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <span className="rounded bg-white p-1"><Image src="/brand/hira-logo-small.png" alt="HIRA Associates" width={44} height={29} className="h-7 w-auto" /></span>
          <span className="leading-tight text-white">
            <span className="block text-sm font-semibold">GST Audit 360°</span>
            <span className="block text-[10px] text-hira-200">HIRA Associates</span>
          </span>
        </Link>
        <SideNav groups={groups} />
        <p className="mt-auto px-4 py-3 text-[10px] leading-snug text-hira-200/70">Every Transaction Verified.<br />Every GST Risk Identified.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white/95 px-4 backdrop-blur md:px-8">
          <Link href="/dashboard" className="text-sm font-semibold text-hira-800 md:hidden">HIRA GST Audit 360°</Link>
          <div className="hidden text-xs text-muted-foreground md:block">Confidential — client data is restricted to authorised engagement staff</div>
          <div className="flex items-center gap-3">
            <Link href="/account/security" className="text-right leading-tight">
              <span className="block text-sm font-medium">{user.fullName}</span>
              <span className="block text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</span>
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
