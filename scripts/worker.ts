/**
 * Durable background worker: claims queued jobs (FOR UPDATE SKIP LOCKED) and runs them.
 * Run one or more instances anywhere with network access to the database:  npm run worker
 */
import { config } from "dotenv";
config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
const { processQueue } = await import("@/lib/jobs/queue");
await import("@/lib/jobs/handlers");

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
console.log(`[worker] started pid=${process.pid}`);
while (!stopping) {
  try {
    const n = await processQueue(10, 60_000);
    if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    else console.log(`[worker] processed ${n} job(s)`);
  } catch (e) {
    console.error("[worker] error", e instanceof Error ? e.message : e);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
console.log("[worker] stopped");
process.exit(0);
