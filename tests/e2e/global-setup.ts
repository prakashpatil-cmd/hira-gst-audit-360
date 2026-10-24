import { execSync } from "node:child_process";
import fs from "node:fs";
import postgres from "postgres";
import { E2E_ENV } from "../../playwright.config";

export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@hira.test", password: process.env.E2E_ADMIN_PASSWORD ?? "Admin@Hira2026!" };

/** Fresh database: migrations, seed (firm, admin, control library, legal library, templates) and demo files. */
export default async function globalSetup() {
  const admin = postgres(E2E_ENV.DATABASE_URL.replace(/\/[^/]+$/, "/postgres"), { onnotice: () => {} });
  const db = E2E_ENV.DATABASE_URL.split("/").pop()!;
  await admin.unsafe(`drop database if exists ${db} with (force)`);
  await admin.unsafe(`create database ${db}`);
  await admin.end();
  fs.rmSync("storage-e2e", { recursive: true, force: true });
  const env = { ...process.env, ...E2E_ENV, DOTENV_PATH: "/dev/null", SEED_ADMIN_EMAIL: ADMIN.email, SEED_ADMIN_PASSWORD: ADMIN.password, SEED_ADMIN_NAME: "Prakash Patil" };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx --tsconfig tsconfig.scripts.json scripts/seed.ts", { env, stdio: "inherit" });
  if (!fs.existsSync("samples/demo/01_sales_register_MH.xlsx")) execSync("npx tsx --tsconfig tsconfig.scripts.json scripts/generate-demo-data.ts", { env, stdio: "inherit" });
  // Fixture assumption: the firm's legal library has been reviewed. Record that approval by the seeded Super Administrator.
  const sql = postgres(E2E_ENV.DATABASE_URL, { onnotice: () => {} });
  await sql`update public.legal_references set approval_status = 'approved', verification_status = 'verified', verified_at = now(), approved_at = now(),
    approved_by = (select id from public.users where email = ${ADMIN.email}), verified_by = (select id from public.users where email = ${ADMIN.email})`;
  await sql.end();
}
