"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, ClipboardList, BookOpen, Library, FileArchive, ListChecks, Users, Settings, ScrollText, Scale, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { LayoutDashboard, Building2, ClipboardList, BookOpen, Library, FileArchive, ListChecks, Users, Settings, ScrollText, Scale, ShieldCheck };
export interface NavItem { href: string; label: string; icon: keyof typeof ICONS }
export interface NavGroup { label: string; items: NavItem[] }

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-5 px-3 py-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-hira-200/70">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = ICONS[it.icon];
              const active = path === it.href || path.startsWith(it.href + "/");
              return (
                <li key={it.href}>
                  <Link href={it.href} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-hira-50/90 transition-colors hover:bg-white/10",
                    active && "bg-white/15 font-medium text-white")}>
                    <Icon className="h-4 w-4 opacity-80" />{it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function TabNav({ base, items }: { base: string; items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <div className="-mx-1 mb-6 overflow-x-auto border-b">
      <div className="flex min-w-max gap-1 px-1">
        {items.map((it) => {
          const href = `${base}${it.href}`;
          const active = it.href === "" ? path === base : path === href || path.startsWith(href + "/");
          return (
            <Link key={it.href} href={href} className={cn("border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active ? "border-primary font-medium text-hira-800" : "border-transparent")}>{it.label}</Link>
          );
        })}
      </div>
    </div>
  );
}
