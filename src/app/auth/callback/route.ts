import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth/supabase";

/** Supabase email links (password recovery, invitations) land here to exchange the code for a session. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  if (code) await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard", req.url));
}
