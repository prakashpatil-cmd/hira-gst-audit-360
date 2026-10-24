import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const [job] = await withUser(user.id, (tx) => tx`select id, job_type, status, progress, progress_message, error, finished_at from public.jobs where id = ${id}`);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
}
