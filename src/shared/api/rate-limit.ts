/**
 * In-memory token bucket. The app runs on ONE instance (nginx → a single
 * `next start`), so per-process buckets are exact. When the web tier is
 * scaled out, replace the `Map` below with a MySQL/Redis-backed store
 * behind the same `take()` signature — every caller goes through it.
 */
export interface BucketOptions {
  /** Max burst. */
  capacity: number;
  /** Sustained rate. 60 req/min → 1. */
  refillPerSec: number;
}

export interface TakeResult {
  ok: boolean;
  /** Tokens left after this call (0 when refused). */
  remaining: number;
  /** Seconds until one token is available (0 when ok). */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_BUCKETS = 50_000;
const buckets = new Map<string, Bucket>();

function refill(b: Bucket, opts: BucketOptions, now: number): void {
  const elapsed = Math.max(0, now - b.updatedAt) / 1000;
  b.tokens = Math.min(opts.capacity, b.tokens + elapsed * opts.refillPerSec);
  b.updatedAt = now;
}

export function take(key: string, opts: BucketOptions, now: number = Date.now()): TakeResult {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      // Bound memory under a key-spraying attack: drop the oldest entries.
      const drop = Math.ceil(MAX_BUCKETS / 10);
      let i = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++i >= drop) break;
      }
    }
    b = { tokens: opts.capacity, updatedAt: now };
    buckets.set(key, b);
  } else {
    refill(b, opts, now);
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
  }
  const retryAfterSec = Math.max(1, Math.ceil((1 - b.tokens) / opts.refillPerSec));
  return { ok: false, remaining: 0, retryAfterSec };
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
