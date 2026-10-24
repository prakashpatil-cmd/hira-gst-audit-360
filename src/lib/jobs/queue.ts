import "server-only";
import os from "node:os";
import { serviceSql, type Tx } from "@/lib/db";

export type JobType = "import.validate" | "import.commit" | "recon.run" | "report.generate" | "checks.run";

export interface JobRow {
  id: string; organisation_id: string; engagement_id: string | null; job_type: JobType; payload: Record<string, unknown>;
  status: string; attempts: number; max_attempts: number; created_by: string | null;
}

export type JobHandler = (job: JobRow, progress: (pct: number, msg?: string) => Promise<void>) => Promise<unknown>;
const handlers = new Map<JobType, JobHandler>();
export function registerJobHandler(type: JobType, h: JobHandler) { handlers.set(type, h); }

/** Enqueue inside the caller's (RLS-checked) transaction — the insert itself proves engagement access. */
export async function enqueueJob(tx: Tx, job: { organisationId: string; engagementId: string | null; type: JobType;
  payload: Record<string, unknown>; createdBy: string; idempotencyKey?: string }): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.jobs (organisation_id, engagement_id, job_type, payload, created_by, idempotency_key)
    values (${job.organisationId}, ${job.engagementId}, ${job.type}, ${tx.json(job.payload as never)}, ${job.createdBy}, ${job.idempotencyKey ?? null})
    on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id`;
  return row.id;
}

const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** Claims the next runnable job (FOR UPDATE SKIP LOCKED) — safe with many concurrent workers. */
export async function claimJob(specificId?: string): Promise<JobRow | null> {
  const sql = serviceSql();
  const rows = await sql<JobRow[]>`
    update public.jobs set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = ${WORKER_ID}, progress = 0
    where id = (
      select id from public.jobs
      where status = 'queued' and run_after <= now() ${specificId ? sql`and id = ${specificId}` : sql``}
      order by created_at limit 1 for update skip locked)
    returning id, organisation_id, engagement_id, job_type, payload, status, attempts, max_attempts, created_by`;
  return rows[0] ?? null;
}

export async function runJob(job: JobRow): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const sql = serviceSql();
  const handler = handlers.get(job.job_type);
  const progress = async (pct: number, msg?: string) => {
    await sql`update public.jobs set progress = ${Math.max(0, Math.min(100, Math.round(pct)))}, progress_message = ${msg ?? null} where id = ${job.id}`;
  };
  try {
    if (!handler) throw new Error(`No handler for job type ${job.job_type}`);
    const result = await handler(job, progress);
    await sql`update public.jobs set status = 'completed', progress = 100, result = ${sql.json((result ?? null) as never)}, finished_at = now(), error = null where id = ${job.id}`;
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retry = job.attempts < job.max_attempts && !(e instanceof PermanentJobError);
    await sql`update public.jobs set status = ${retry ? "queued" : "failed"}, error = ${msg.slice(0, 2000)},
      run_after = now() + make_interval(secs => ${30 * job.attempts}), finished_at = ${retry ? null : sql`now()`} where id = ${job.id}`;
    return { ok: false, error: msg };
  }
}

export class PermanentJobError extends Error {}

/** Re-queues jobs whose worker died (locked for more than 15 minutes). */
export async function recoverStaleJobs() {
  await serviceSql()`update public.jobs set status = 'queued', locked_at = null, locked_by = null
    where status = 'running' and locked_at < now() - interval '15 minutes'`;
}

export async function processQueue(maxJobs = 5, deadlineMs = 50_000): Promise<number> {
  const start = Date.now();
  let n = 0;
  await recoverStaleJobs();
  while (n < maxJobs && Date.now() - start < deadlineMs) {
    const job = await claimJob();
    if (!job) break;
    await runJob(job);
    n++;
  }
  return n;
}
