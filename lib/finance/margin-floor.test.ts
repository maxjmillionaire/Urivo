import { describe, it, expect } from "vitest";
import {
  simulateTier,
  assessMonth2MarginFloor,
  MONTH2_MARGIN_FLOOR_PCT,
} from "./simulator";

/*
 * Finance-correctness guards (no product behaviour):
 *   1. the agreed investor share is 3%, not 5%;
 *   2. the internal Month-2 contribution-margin floor is 70% and reports,
 *      never blocks.
 */

describe("investor share is the agreed 3%", () => {
  it("defaults investorEur to 3% of price", () => {
    const core = simulateTier({ priceEur: 49, monthlyCredits: 150 });
    expect(core.investorEur).toBeCloseTo(49 * 0.03, 9); // €1.47, not €2.45
  });

  it("still honours an explicit override", () => {
    const s = simulateTier({ priceEur: 49, monthlyCredits: 150, investorShare: 0.05 });
    expect(s.investorEur).toBeCloseTo(49 * 0.05, 9);
  });
});

describe("Month-2 contribution-margin floor (70%)", () => {
  it("pins the floor at 70", () => {
    expect(MONTH2_MARGIN_FLOOR_PCT).toBe(70);
  });

  it("reports headroom above the floor without flagging", () => {
    const s = assessMonth2MarginFloor(91.5);
    expect(s.floorPct).toBe(70);
    expect(s.headroomPp).toBeCloseTo(21.5, 9);
    expect(s.belowFloor).toBe(false);
    expect(s.label).toBe("OK");
  });

  it("flags a breach with the exact reporting string", () => {
    const s = assessMonth2MarginFloor(68.9);
    expect(s.belowFloor).toBe(true);
    expect(s.headroomPp).toBeCloseTo(-1.1, 9);
    expect(s.label).toBe("BELOW M2 MARGIN FLOOR");
  });

  it("treats exactly 70% as on-floor, not below", () => {
    const s = assessMonth2MarginFloor(70);
    expect(s.belowFloor).toBe(false);
    expect(s.headroomPp).toBe(0);
  });

  it("the real Core tier clears the floor at expected usage", () => {
    const core = simulateTier({ priceEur: 49, monthlyCredits: 150 });
    // Month-2 contribution margin excludes fixed AND the one-time creator cost.
    expect(core.contributionMarginRealisticPct).toBeGreaterThan(70);
    expect(core.month2Floor.belowFloor).toBe(false);
    expect(core.month2Floor.label).toBe("OK");
  });
});
