import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { objectStore } from "@/lib/storage";
import { logAction } from "@/lib/audit-log";

/** Streams a private file after an RLS-checked lookup; every download is written to the audit log. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.mfaVerified) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const doc = await withUser(user.id, async (tx) => {
    const [d] = await tx<{ id: string; storage_path: string; file_name: string; mime_type: string; engagement_id: string | null; scan_status: string }[]>`
      select id, storage_path, file_name, mime_type, engagement_id, scan_status from public.source_documents where id = ${id} and deleted_at is null`;
    if (d) await logAction(tx, { organisationId: user.orgId, actorId: user.id, action: "download", entityType: "source_documents", entityId: d.id, engagementId: d.engagement_id });
    return d;
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.scan_status === "infected") return NextResponse.json({ error: "file quarantined" }, { status: 403 });
  const body = await objectStore().get(doc.storage_path);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": doc.mime_type,
      "content-disposition": `attachment; filename="${doc.file_name.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
