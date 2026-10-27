import { describe, expect, it } from "vitest";
import { normaliseDbUrl, withAliases } from "@/lib/env";

describe("environment aliases (Supabase ↔ Vercel integration)", () => {
  it("uses the integration's variable names when ours are absent", () => {
    const e = withAliases({ NODE_ENV: "production", POSTGRES_URL: "postgres://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x",
      SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_y" });
    expect(e.DATABASE_URL).toBe("postgres://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(e.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
    expect(e.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_x");
    expect(e.SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_y");
  });
  it("prefers explicitly set variables", () => {
    const e = withAliases({ NODE_ENV: "production", DATABASE_URL: "postgres://a@localhost/x", POSTGRES_URL: "postgres://b@other/y", SUPABASE_SERVICE_ROLE_KEY: "mine", SUPABASE_SECRET_KEY: "theirs" });
    expect(e.DATABASE_URL).toBe("postgres://a@localhost/x");
    expect(e.SUPABASE_SERVICE_ROLE_KEY).toBe("mine");
  });
  it("requires TLS for Supabase hosts and leaves local URLs alone", () => {
    expect(normaliseDbUrl("postgres://u:p@db.abc.supabase.co:5432/postgres")).toBe("postgres://u:p@db.abc.supabase.co:5432/postgres?sslmode=require");
    expect(normaliseDbUrl("postgres://postgres:postgres@localhost:5432/hira_gst")).toBe("postgres://postgres:postgres@localhost:5432/hira_gst");
  });
});
