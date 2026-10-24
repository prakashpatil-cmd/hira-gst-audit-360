/**
 * Fixed-window rate limiter (per server instance). Adequate as a first line of defence; on a
 * multi-instance deployment add the Vercel WAF rate-limit rule described in docs/SECURITY.md.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  return b.count > limit ? { ok: false, retryAfterSec: Math.ceil((b.reset - now) / 1000) } : { ok: true, retryAfterSec: 0 };
}
