import { describe, it, expect } from "vitest";
import { CREDIT_COSTS, creditCost } from "./credit-costs";

describe("credit costs — the price of every AI action", () => {
  it("locks the published per-action costs (a silent change here mis-charges users)", () => {
    expect(CREDIT_COSTS.storeGeneration).toBe(20);
    expect(CREDIT_COSTS.askMessage).toBe(1);
    expect(CREDIT_COSTS.marketResearch).toBe(3);
    expect(CREDIT_COSTS.adStudio).toBe(3);
    expect(CREDIT_COSTS.productImage).toBe(2);
  });

  it("creditCost resolves by action", () => {
    expect(creditCost("storeGeneration")).toBe(20);
    expect(creditCost("askMessage")).toBe(1);
    expect(creditCost("productImage")).toBe(2);
  });
});
