import { describe, it, expect } from "vitest";
import {
  firstSaleVerdict,
  FIRST_SALE_HEALTHY,
  FIRST_SALE_CRITICAL,
  type FirstSaleFunnel,
} from "./first-sale";

/*
 * The verdict encodes the decision rule we run the company by: below CRITICAL
 * we stop spending on growth, above HEALTHY we scale. A silent inversion here
 * would tell us to scale a broken product, so the boundaries are pinned.
 */

const funnel = (published: number, rate: number): FirstSaleFunnel => ({
  storesPublished: published,
  storesWithSale: Math.round((published * rate) / 100),
  firstSaleRate: rate,
  soldWithin7d: 0,
  soldWithin30d: 0,
  soldWithin90d: 0,
  rateWithin30d: 0,
  medianDaysToFirstSale: null,
  avgDaysToFirstSale: null,
});

describe("firstSaleVerdict", () => {
  it("reports no_data before anything is published, rather than guessing", () => {
    expect(firstSaleVerdict(funnel(0, 0))).toBe("no_data");
  });

  it("is critical below the floor", () => {
    expect(firstSaleVerdict(funnel(100, 0))).toBe("critical");
    expect(firstSaleVerdict(funnel(100, 9.9))).toBe("critical");
  });

  it("treats exactly the floor as watch, not critical", () => {
    expect(firstSaleVerdict(funnel(100, FIRST_SALE_CRITICAL))).toBe("watch");
  });

  it("is watch between the floor and the healthy mark", () => {
    expect(firstSaleVerdict(funnel(100, 18))).toBe("watch");
    expect(firstSaleVerdict(funnel(100, 24.9))).toBe("watch");
  });

  it("treats exactly the healthy mark as healthy", () => {
    expect(firstSaleVerdict(funnel(100, FIRST_SALE_HEALTHY))).toBe("healthy");
  });

  it("is healthy above the mark", () => {
    expect(firstSaleVerdict(funnel(100, 60))).toBe("healthy");
  });

  it("does not report healthy on zero published stores even if the rate reads high", () => {
    // Guards against a divide-by-zero upstream producing a misleading verdict.
    expect(firstSaleVerdict(funnel(0, 100))).toBe("no_data");
  });

  it("keeps the thresholds in the order the decision rule assumes", () => {
    expect(FIRST_SALE_CRITICAL).toBeLessThan(FIRST_SALE_HEALTHY);
  });
});
