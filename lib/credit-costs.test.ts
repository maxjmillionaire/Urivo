import { describe, it, expect } from "vitest";
import { CREDIT_COSTS, creditCost } from "./credit-costs";
import { PLANS } from "./plans";
import { CREDIT_PACKS } from "./credit-packs";

describe("credit costs — the price of every AI action", () => {
  it("locks the published per-action costs (a silent change here mis-charges users)", () => {
    expect(CREDIT_COSTS.storeGeneration).toBe(20);
    expect(CREDIT_COSTS.askMessage).toBe(2);
    expect(CREDIT_COSTS.marketResearch).toBe(4);
    expect(CREDIT_COSTS.adStudio).toBe(4);
    expect(CREDIT_COSTS.productImage).toBe(3);
  });

  it("creditCost resolves by action", () => {
    expect(creditCost("storeGeneration")).toBe(20);
    expect(creditCost("askMessage")).toBe(2);
    expect(creditCost("productImage")).toBe(3);
  });
});

/*
 * The funnel invariants. Raising a price is a business decision; breaking the
 * path a new user walks before they have paid anything is not — and the two
 * look identical in a diff. These pin the difference.
 */
describe("pricing never closes the top of the funnel", () => {
  it("lets a free signup generate exactly one complete store", () => {
    // If signup credits ever fall below the cost of a store, a new user can
    // generate NOTHING and the product has no first moment at all.
    expect(PLANS.free.signupCredits).toBeGreaterThanOrEqual(CREDIT_COSTS.storeGeneration);
  });

  it("gives a paying Founder room for several stores plus real iteration", () => {
    const stores = Math.floor(PLANS.core.monthlyCredits / CREDIT_COSTS.storeGeneration);
    expect(stores).toBeGreaterThanOrEqual(5);
    // A store the founder cannot then refine is not worth generating.
    const afterOneStore = PLANS.core.monthlyCredits - CREDIT_COSTS.storeGeneration;
    expect(Math.floor(afterOneStore / CREDIT_COSTS.askMessage)).toBeGreaterThanOrEqual(30);
  });

  it("keeps Pro a real step up, not a rounding difference", () => {
    expect(PLANS.pro.monthlyCredits).toBeGreaterThan(PLANS.core.monthlyCredits * 2);
  });

  it("prices every pack above the subscription rate, so packs never undercut a plan", () => {
    const founderRate = PLANS.core.price.regular / PLANS.core.monthlyCredits;
    for (const pack of Object.values(CREDIT_PACKS)) {
      expect(pack.priceEUR / pack.credits).toBeGreaterThan(founderRate);
    }
  });

  it("keeps the smallest pack worth buying — at least one store", () => {
    const smallest = Object.values(CREDIT_PACKS).reduce((a, b) => (a.credits < b.credits ? a : b));
    expect(smallest.credits).toBeGreaterThanOrEqual(CREDIT_COSTS.storeGeneration);
  });
});
