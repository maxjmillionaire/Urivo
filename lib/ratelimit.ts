import "server-only";

/*
 * Rate limiting (spec 6.1, 6.3 §21). Uses Upstash Redis when configured
 * (stateless, works across instances — spec 6.3 §34); otherwise falls back
 * to a per-instance in-memory sliding window so local/single-instance runs
 * are still protected. Provider isolated behind this module (spec 6.9).
 */

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const memoryHits = new Map<string, number[]>();

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (memoryHits.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    memoryHits.set(key, hits);
    return { success: false, remaining: 0, retryAfterSeconds };
  }
  hits.push(now);
  memoryHits.set(key, hits);
  // Opportunistic cleanup to bound memory.
  if (memoryHits.size > 5000) {
    for (const [k, v] of memoryHits) {
      if (v.every((t) => t <= cutoff)) memoryHits.delete(k);
    }
  }
  return { success: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

async function upstashLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `ratelimit:${key}`;
  try {
    // INCR then set TTL on first hit — a simple fixed-window counter.
    const pipeline = [
      ["INCR", redisKey],
      ["TTL", redisKey],
    ];
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(pipeline),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const [incr, ttl] = (await res.json()) as { result: number }[];
    const count = incr.result;
    let ttlSec = ttl.result;
    if (ttlSec < 0) {
      await fetch(`${url}/expire/${encodeURIComponent(redisKey)}/${windowSec}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      ttlSec = windowSec;
    }
    if (count > limit) {
      return { success: false, remaining: 0, retryAfterSeconds: Math.max(1, ttlSec) };
    }
    return { success: true, remaining: limit - count, retryAfterSeconds: 0 };
  } catch {
    // Redis unavailable → never break the app (spec 6.9 failure strategy).
    return null;
  }
}

/**
 * Sliding/fixed-window limiter. `key` should already be scoped
 * (e.g. `generate:${userId}`).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const upstash = await upstashLimit(key, limit, windowMs);
  if (upstash) return upstash;
  return memoryLimit(key, limit, windowMs);
}
