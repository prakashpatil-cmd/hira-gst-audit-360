import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClientAction } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requirePermission("clients.manage");
  return (
    <>
      <PageHeader title="New client" crumbs={[{ href: "/clients", label: "Client master" }, { label: "New" }]}
        description="GST registrations and places of business are added after the client is created." />
      <Card><CardContent className="pt-5"><ClientForm action={createClientAction} submitLabel="Create client" /></CardContent></Card>
    </>
  );
}
