import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "../(auth)/actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowClient: true });
  if (!user.isClientUser) redirect("/dashboard");
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b bg-white px-6">
        <div className="flex items-center gap-3"><Image src="/brand/hira-logo-small.png" alt="HIRA Associates" width={60} height={40} className="h-10 w-auto" />
          <div><p className="text-sm font-semibold text-hira-800">Client Response Portal</p><p className="text-xs text-muted-foreground">HIRA GST Audit 360°</p></div></div>
        <div className="flex items-center gap-4 text-sm"><Link href="/account/security" className="hover:underline">{user.fullName}</Link>
          <form action={logoutAction}><button className="text-muted-foreground hover:text-foreground">Sign out</button></form></div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
