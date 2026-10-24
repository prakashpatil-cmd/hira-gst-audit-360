import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = [/^\/login/, /^\/forgot-password/, /^\/reset-password/, /^\/auth\//, /^\/api\/cron\//, /^\/api\/health/];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some((r) => r.test(path));
  let res = NextResponse.next({ request: req });

  if (process.env.AUTH_PROVIDER === "supabase") {
    // Refresh the Supabase session cookie on every request.
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await sb.auth.getUser();
    if (!data.user && !isPublic) return NextResponse.redirect(new URL("/login", req.url));
    return res;
  }
  if (!isPublic && !req.cookies.get("hira_session")) {
    const url = new URL("/login", req.url);
    if (path !== "/") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"] };
