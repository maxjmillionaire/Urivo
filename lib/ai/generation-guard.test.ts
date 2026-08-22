import { describe, it, expect } from "vitest";
import {
  idempotencyKey,
  maxConcurrentGenerations,
  backpressureFor,
  GEN_TTL_SECONDS,
  MAX_GLOBAL_DEFAULT,
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
