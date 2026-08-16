import { describe, it, expect } from "vitest";
import {
  anthropicCostUsd,
  costOfActionExact,
  usdToEur,
  ACTIVE_MODEL,
  ACTION_PROFILES,
  costPerCredit,
} from "./cost-model";
import { CREDIT_COSTS } from "@/lib/credit-costs";

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

/*
 * Every margin figure on the admin dashboard divides an action's cost by its
 * credit price. When those prices were copied into ACTION_PROFILES by hand they
 * went stale — Ask was still modelled at 1 credit weeks after it moved to 2 —
 * so the numbers used to reason about pricing described a product that no
 * longer existed. They are imported now; these lock the seam shut.
 */
describe("modelled prices are the prices actually charged", () => {
  it("matches CREDIT_COSTS for every priced action", () => {
    expect(ACTION_PROFILES.storeGeneration.credits).toBe(CREDIT_COSTS.storeGeneration);
    expect(ACTION_PROFILES.askMessage.credits).toBe(CREDIT_COSTS.askMessage);
    expect(ACTION_PROFILES.marketResearch.credits).toBe(CREDIT_COSTS.marketResearch);
    expect(ACTION_PROFILES.adStudio.credits).toBe(CREDIT_COSTS.adStudio);
    expect(ACTION_PROFILES.productImage.credits).toBe(CREDIT_COSTS.productImage);
  });

  it("prices a store edit as the Ask message it is charged as", () => {
    // The edit route calls spendCredits(CREDIT_COSTS.askMessage); modelling it
    // any other way would overstate or understate the assistant's whole margin.
    expect(ACTION_PROFILES.storeEdit.credits).toBe(CREDIT_COSTS.askMessage);
  });

  it("never divides by zero credits", () => {
    for (const [feature, profile] of Object.entries(ACTION_PROFILES)) {
      expect(profile.credits, `${feature} has no credit price`).toBeGreaterThan(0);
      expect(Number.isFinite(costPerCredit(feature as keyof typeof ACTION_PROFILES))).toBe(true);
    }
  });
});
