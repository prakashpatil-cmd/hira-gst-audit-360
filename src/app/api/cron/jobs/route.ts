import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processQueue } from "@/lib/jobs/queue";
import "@/lib/jobs/handlers";

export const maxDuration = 300;

/** Vercel Cron entry point (also callable by any scheduler): processes queued jobs within the time budget. */
export async function GET(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const n = await processQueue(20, 270_000);
  return NextResponse.json({ processed: n });
}
