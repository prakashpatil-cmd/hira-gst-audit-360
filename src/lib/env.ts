import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DB_LOCAL_SHIM: z.string().optional(),
  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  ALLOW_LOCAL_AUTH: z.string().optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  CLAMAV_HOST: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  INLINE_JOBS: z.string().optional(),
  AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
});

export type Env = z.infer<typeof schema>;

/**
 * Accepts the variable names written by the Supabase ↔ Vercel integration (POSTGRES_URL, SUPABASE_URL,
 * publishable/secret keys) as well as our own, so the integration can configure a deployment without copying keys.
 */
export function withAliases(src: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const pick = (...keys: string[]) => keys.map((k) => src[k]).find((v) => v && v.trim()) || undefined;
  return {
    ...src,
    DATABASE_URL: normaliseDbUrl(pick("DATABASE_URL", "POSTGRES_URL")),
    NEXT_PUBLIC_SUPABASE_URL: pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: pick("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),
  };
}

/** Keeps only sslmode from the query string (other parameters would be sent to Postgres as settings) and requires TLS for Supabase hosts. */
export function normaliseDbUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  const sslmode = u.searchParams.get("sslmode");
  u.search = "";
  if (sslmode) u.searchParams.set("sslmode", sslmode);
  else if (/\.supabase\.(co|com)$/.test(u.hostname)) u.searchParams.set("sslmode", "require");
  return u.toString();
}
let cached: Env | null = null;

/** Server-only environment. Throws on misconfiguration rather than running insecurely. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(withAliases(process.env));
  if (!parsed.success) {
    throw new Error("Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const e = parsed.data;
  if (e.APP_ENV === "production" && e.AUTH_PROVIDER === "local" && e.ALLOW_LOCAL_AUTH !== "true") {
    throw new Error("AUTH_PROVIDER=local is disabled in production. Use Supabase Auth or set ALLOW_LOCAL_AUTH=true deliberately.");
  }
  if (e.AUTH_PROVIDER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    throw new Error("Supabase Auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (e.STORAGE_PROVIDER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("Supabase Storage requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  cached = e;
  return e;
}
