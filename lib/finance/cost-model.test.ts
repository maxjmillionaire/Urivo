import { describe, it, expect } from "vitest";
import { anthropicCostUsd, costOfActionExact, usdToEur, ACTIVE_MODEL } from "./cost-model";

describe("cost model — real money math", () => {
  it("computes token cost on a known model", () => {
    // Opus input is $5 / 1M tokens.
    expect(anthropicCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, "claude-opus-4-8")).toBeCloseTo(5, 6);
    // Opus output is $25 / 1M tokens.
    expect(anthropicCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }, "claude-opus-4-8")).toBeCloseTo(25, 6);
  });

  it("falls back to the default's pricing for an UNPRICED (env-routed) model instead of throwing", () => {
    const known = anthropicCostUsd({ inputTokens: 1000, outputTokens: 1000 }, ACTIVE_MODEL);
    const routed = anthropicCostUsd({ inputTokens: 1000, outputTokens: 1000 }, "some-future-model");
    expect(routed).toBe(known);
    expect(Number.isFinite(routed)).toBe(true);
  });

  it("costOfActionExact adds image cost, stays finite, and EUR mirrors USD", () => {
    const c = costOfActionExact({ inputTokens: 0, outputTokens: 0 }, 3, "unpriced-x");
    expect(Number.isFinite(c.totalUsd)).toBe(true);
    expect(c.imageUsd).toBeGreaterThan(0);
    expect(c.totalUsd).toBeCloseTo(c.anthropicUsd + c.imageUsd, 9);
    expect(c.totalEur).toBeCloseTo(usdToEur(c.totalUsd), 9);
  });
});
