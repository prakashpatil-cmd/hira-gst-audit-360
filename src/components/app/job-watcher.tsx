"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Polls a background job and refreshes the page when it finishes. */
export function JobWatcher({ jobId, label }: { jobId: string; label: string }) {
  const router = useRouter();
  const [s, setS] = useState<{ status: string; progress: number; progress_message: string | null; error: string | null } | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!r.ok || stop) return;
      const j = await r.json();
      setS(j);
      if (j.status === "completed" || j.status === "failed") { router.refresh(); return; }
      setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, [jobId, router]);
  if (!s || s.status === "completed") return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {s.status === "failed" ? <span>{label} failed: {s.error}</span> : <>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}: {s.status === "queued" ? "queued for the background worker" : `${s.progress}%`} {s.progress_message ? `— ${s.progress_message}` : ""}</span>
      </>}
    </div>
  );
}
