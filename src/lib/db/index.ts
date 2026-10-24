import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

const g = globalThis as unknown as { __hiraSql?: Sql };

function create(): Sql {
  return postgres(env().DATABASE_URL, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    prepare: false,               // compatible with Supabase transaction pooler
    idle_timeout: 20,
    onnotice: () => {},
    types: {
      // keep DATE columns as "YYYY-MM-DD" strings (no time-zone drift)
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

/** Owner connection. Bypasses RLS — only for system jobs after explicit authorisation checks. */
export function serviceSql(): Sql {
  if (!g.__hiraSql) g.__hiraSql = create();
  return g.__hiraSql;
}

/**
 * Runs `fn` in a transaction as the Postgres role `authenticated` with the user's id in
 * request.jwt.claims, exactly as Supabase PostgREST does — so every query is filtered by RLS.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = serviceSql();
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/** Runs as the system (no RLS) but stamps the acting user on audit-log rows via auth.uid(). */
export async function asSystem<T>(actorId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = serviceSql();
  return sql.begin(async (tx) => {
    if (actorId) await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId, role: "service_role" })}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
