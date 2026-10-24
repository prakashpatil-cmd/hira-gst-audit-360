import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";
import { claimJob, runJob } from "./queue";
import "./handlers";

/**
 * Starts a queued job promptly. INLINE_JOBS=true runs it before the response (development);
 * otherwise it runs after the response within the same function invocation. Either way the job
 * row is durable: if this invocation dies, the worker or the cron endpoint picks it up.
 */
export async function kickJob(jobId: string) {
  const exec = async () => {
    const job = await claimJob(jobId);
    if (job) await runJob(job);
  };
  if (env().INLINE_JOBS === "true") await exec();
  else after(exec);
}
