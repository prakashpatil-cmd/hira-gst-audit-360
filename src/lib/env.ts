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
  AI_MODEL: z.string().default("claude-sonnet-5-5"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Server-only environment. Throws on misconfiguration rather than running insecurely. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
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
