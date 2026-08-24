import { describe, it, expect } from "vitest";
import {
  idempotencyKey,
  maxConcurrentGenerations,
  backpressureFor,
  decideClaim,
  GUARD_UNAVAILABLE,
  GEN_TTL_SECONDS,
  MAX_GLOBAL_DEFAULT,
  type ClaimRow,
} from "./generation-guard";

/*
 * The durable protection lives in Postgres (claim_generation_job); this pins the
 * thin route edge: how a dedup key is chosen and how a refused claim becomes a
 * controlled response — a 429/409 with Retry-After, never a 500 and never a fake
 * "queued".
 */

describe("idempotencyKey", () => {
  it("prefers a client Idempotency-Key, trimmed and bounded", () => {
    expect(idempotencyKey("  abc-123  ", "nordljus")).toBe("abc-123");
    expect(idempotencyKey("x".repeat(500), "nordljus")).toHaveLength(120);
  });
  it("falls back to the subdomain (its natural identity) when no header", () => {
    expect(idempotencyKey(null, "nordljus")).toBe("nordljus");
    expect(idempotencyKey("", "nordljus")).toBe("nordljus");
    expect(idempotencyKey("   ", "nordljus")).toBe("nordljus");
  });
});

describe("maxConcurrentGenerations", () => {
  it("reads a positive integer from env", () => {
    expect(maxConcurrentGenerations("12")).toBe(12);
  });
  it("floors and clamps junk / sub-1 values to the default", () => {
    expect(maxConcurrentGenerations(undefined)).toBe(MAX_GLOBAL_DEFAULT);
    expect(maxConcurrentGenerations("nonsense")).toBe(MAX_GLOBAL_DEFAULT);
    expect(maxConcurrentGenerations("0")).toBe(MAX_GLOBAL_DEFAULT);
    expect(maxConcurrentGenerations("-5")).toBe(MAX_GLOBAL_DEFAULT);
    expect(maxConcurrentGenerations("4.9")).toBe(4);
  });
});

describe("backpressureFor", () => {
  it("gives a 409 + Retry-After for an in-flight identical request", () => {
    const bp = backpressureFor("in_progress");
    expect(bp).toMatchObject({ status: 409, retryAfter: 5 });
  });
  it("gives a 429 + Retry-After for per-user and global saturation", () => {
    expect(backpressureFor("busy_user")).toMatchObject({ status: 429, retryAfter: 10 });
    expect(backpressureFor("busy_global")).toMatchObject({ status: 429, retryAfter: 15 });
  });
  it("returns null for outcomes the route handles itself", () => {
    expect(backpressureFor("claimed")).toBeNull();
    expect(backpressureFor("duplicate_succeeded")).toBeNull();
    expect(backpressureFor("")).toBeNull();
    expect(backpressureFor(null)).toBeNull();
  });
  it("never invents a 'queued' state", () => {
    for (const o of ["in_progress", "busy_user", "busy_global"]) {
      expect(backpressureFor(o)!.message.toLowerCase()).not.toContain("queue");
    }
  });
});

describe("lock TTL", () => {
  it("outlives the route's 300s maxDuration so a live run is never stolen", () => {
    expect(GEN_TTL_SECONDS).toBeGreaterThan(300);
  });
});

describe("decideClaim — FAILS CLOSED", () => {
  const row = (o: string, over: Partial<ClaimRow> = {}): ClaimRow[] => [
    { outcome: o, job_id: null, store_id: null, ...over },
  ];

  it("proceeds ONLY on a 'claimed' outcome carrying a job id", () => {
    expect(decideClaim(false, row("claimed", { job_id: "job-1" }))).toEqual({ kind: "proceed", jobId: "job-1" });
  });

  it("fails closed on a database/infra error — never enters the pipeline", () => {
    expect(decideClaim(true, row("claimed", { job_id: "job-1" }))).toEqual({ kind: "fail_closed", reason: "claim_rpc_error" });
  });

  it("fails closed when the RPC returns no rows (null / empty)", () => {
    expect(decideClaim(false, null)).toEqual({ kind: "fail_closed", reason: "no_outcome" });
    expect(decideClaim(false, [])).toEqual({ kind: "fail_closed", reason: "no_outcome" });
    expect(decideClaim(false, undefined)).toEqual({ kind: "fail_closed", reason: "no_outcome" });
  });

  it("fails closed on 'claimed' with no job id (guard could not be proven)", () => {
    expect(decideClaim(false, row("claimed", { job_id: null }))).toEqual({ kind: "fail_closed", reason: "unexpected:claimed" });
  });

  it("fails closed on an unrecognised outcome", () => {
    expect(decideClaim(false, row("weird_new_state"))).toMatchObject({ kind: "fail_closed" });
  });

  it("still replays an idempotent success and still applies backpressure", () => {
    expect(decideClaim(false, row("duplicate_succeeded", { store_id: "store-9" }))).toEqual({ kind: "replay", storeId: "store-9" });
    expect(decideClaim(false, row("busy_user"))).toMatchObject({ kind: "backpressure" });
    expect(decideClaim(false, row("busy_global"))).toMatchObject({ kind: "backpressure" });
    expect(decideClaim(false, row("in_progress"))).toMatchObject({ kind: "backpressure" });
  });

  it("the fail-closed response is a retryable 503 with Retry-After", () => {
    expect(GUARD_UNAVAILABLE.status).toBe(503);
    expect(GUARD_UNAVAILABLE.retryAfter).toBeGreaterThan(0);
  });
});
