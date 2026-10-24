/**
 * Applies SQL migrations in order and records them in public.schema_migrations.
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --reset drop and recreate everything (refuses unless DB_LOCAL_SHIM=true)
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

config({ path: process.env.DOTENV_PATH ?? ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const local = process.env.DB_LOCAL_SHIM === "true";
  const reset = process.argv.includes("--reset");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (reset) {
      if (!local) throw new Error("--reset is only permitted on local databases (DB_LOCAL_SHIM=true)");
      await sql.unsafe(`drop schema if exists public cascade; drop schema if exists app cascade;
        drop schema if exists local_auth cascade; drop schema if exists auth cascade; create schema public;`);
      console.log("Database reset.");
    }
    const files: { dir: string; name: string }[] = [];
    if (local) for (const f of fs.readdirSync("db/local").sort()) if (f.endsWith(".sql")) files.push({ dir: "db/local", name: f });
    for (const f of fs.readdirSync("supabase/migrations").sort()) if (f.endsWith(".sql")) files.push({ dir: "supabase/migrations", name: f });

    await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql<{ name: string }[]>`select name from public.schema_migrations`).map((r) => r.name));
    for (const f of files) {
      const key = `${f.dir}/${f.name}`;
      if (applied.has(key)) continue;
      const body = fs.readFileSync(path.join(f.dir, f.name), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (name) values (${key})`;
      });
      console.log("applied", key);
    }
    await sql`alter table public.schema_migrations enable row level security`;
    console.log("Migrations up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
