import { NextResponse } from "next/server";
import { serviceSql } from "@/lib/db";

export async function GET() {
  try {
    await serviceSql()`select 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
