/*
 * Route-side helpers for the durable generation guard (Task 3, migration 0059).
 * Pure and isomorphic so the branching the route depends on — how an idempotency
 * key is derived and how a refused claim maps to an HTTP response — is unit-
 * tested rather than only exercised through the live pipeline.
 *
 * The DURABLE part (the per-user lock, idempotency, expiry, ceiling) lives in
 * Postgres (claim_generation_job / finish_generation_job). This module is only
 * the thin edge that reads those outcomes.
 */

/** Beyond the route's maxDuration (300s) so a slow-but-alive run is never stolen. */
export const GEN_TTL_SECONDS = 360;

/** Default ceiling on concurrent expensive generations across all users. */
export const MAX_GLOBAL_DEFAULT = 8;

/** Resolve the global concurrency ceiling from env, clamped to a sane floor. */
export function maxConcurrentGenerations(raw: string | undefined): number {
  const n = Number(raw ?? MAX_GLOBAL_DEFAULT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : MAX_GLOBAL_DEFAULT;
}

/**
 * The dedup key for a generation. A client Idempotency-Key wins; otherwise the
 * subdomain is the request's natural identity, so a double-submit for the same
 * store dedups without any client change. Bounded so a hostile header can't bloat
 * the row.
 */
export function idempotencyKey(header: string | null | undefined, subdomain: string): string {
  return (header ?? "").trim().slice(0, 120) || subdomain;
}

export interface Backpressure {
  status: number;
  error: string;
  message: string;
  /** Seconds — becomes the Retry-After header. */
  retryAfter: number;
}

/**
 * Map a refused claim outcome to a controlled backpressure response — never a
 * 500, and never a fake "queued" (there is no queue). Returns null for outcomes
 * the route handles itself ('claimed', 'duplicate_succeeded') or an unknown one.
 */
export function backpressureFor(outcome: string | null | undefined): Backpressure | null {
  switch (outcome) {
    case "in_progress":
      return {
        status: 409,
        error: "GENERATION_IN_PROGRESS",
        message: "This store is already being generated. Hang tight.",
        retryAfter: 5,
      };
    case "busy_user":
      return {
        status: 429,
        error: "GENERATION_BUSY",
        message: "You already have a store generating. Give it a moment.",
        retryAfter: 10,
      };
    case "busy_global":
      return {
        status: 429,
        error: "HIGH_DEMAND",
        message: "Urivo is handling high demand right now. Please try again in a moment.",
        retryAfter: 15,
      };
    default:
      return null;
  }
}
