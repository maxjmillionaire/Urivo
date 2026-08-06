import { describe, it, expect } from "vitest";
import {
  getPlan,
  maxLiveStores,
  capacityLabel,
  monthlyPrice,
  isLaunchWindow,
  nextPlan,
  isPaid,
  canPublish,
  planName,
  formatPrice,
  priceForUser,
  isFounding,
} from "./plans";

describe("plans — tier + price logic (money-critical)", () => {
  it("normalises any unknown/null plan key to Free (never throws)", () => {
    expect(getPlan("free").key).toBe("free");
    expect(getPlan("core").key).toBe("core");
    expect(getPlan("pro").key).toBe("pro");
    expect(getPlan(null).key).toBe("free");
    expect(getPlan(undefined).key).toBe("free");
    expect(getPlan("garbage").key).toBe("free");
  });

  it("prices are €49 / €199, flat across the launch window (no price drop)", () => {
    const during = new Date("2026-07-25T00:00:00Z");
    const after = new Date("2026-09-01T00:00:00Z");
    expect(isLaunchWindow(during)).toBe(true);
    expect(isLaunchWindow(after)).toBe(false);
    expect(monthlyPrice("core", during)).toBe(49);
    expect(monthlyPrice("core", after)).toBe(49);
    expect(monthlyPrice("pro", during)).toBe(199);
    expect(monthlyPrice("pro", after)).toBe(199);
  });

  it("Free cannot publish and is not paid; paid tiers can", () => {
    expect(isPaid("free")).toBe(false);
    expect(isPaid("core")).toBe(true);
    expect(isPaid("pro")).toBe(true);
    // Free publishes too now — one store. A merchant who has never had a live
    // store has nothing to keep, and people do not pay to keep nothing.
    expect(canPublish("free")).toBe(true);
    expect(canPublish("core")).toBe(true);
  });

  it("nextPlan walks free → Founder → Pro → top", () => {
    expect(nextPlan("free")?.key).toBe("core");
    expect(nextPlan("core")?.key).toBe("pro");
    expect(nextPlan("pro")).toBeNull();
  });

  it("founding members get the lifetime price; everyone else pays standard", () => {
    expect(isFounding("founding")).toBe(true);
    expect(isFounding("standard")).toBe(false);
    // Founding lifetime prices.
    expect(priceForUser("core", "founding")).toBe(29);
    expect(priceForUser("pro", "founding")).toBe(149);
    // Non-founding pays the standard €49 / €199.
    expect(priceForUser("core", "standard")).toBe(49);
    expect(priceForUser("pro", null)).toBe(199);
  });

  it("customer-facing names + price formatting", () => {
    expect(planName("core")).toBe("Founder");
    expect(planName("pro")).toBe("Pro");
    expect(formatPrice(0)).toBe("€0");
    expect(formatPrice(39)).toBe("€39");
  });
});

describe("live-store capacity", () => {
  it("gives Free exactly one live store — the magic moment, not a portfolio", () => {
    expect(maxLiveStores("free")).toBe(1);
  });

  it("gives Founder room to run a few brands without ever feeling capped", () => {
    expect(maxLiveStores("core")).toBe(3);
  });

  it("leaves Pro genuinely unlimited", () => {
    expect(maxLiveStores("pro")).toBeNull();
  });

  it("climbs monotonically — a higher tier never runs fewer stores", () => {
    const rank = (k: string) => maxLiveStores(k) ?? Number.POSITIVE_INFINITY;
    expect(rank("core")).toBeGreaterThan(rank("free"));
    expect(rank("pro")).toBeGreaterThan(rank("core"));
  });

  it("speaks capacity, never restriction", () => {
    expect(capacityLabel("core")).toBe("Run up to 3 live stores");
    expect(capacityLabel("free")).toBe("Run up to 1 live store");
    expect(capacityLabel("pro")).toBe("Unlimited live stores");
    for (const k of ["free", "core", "pro"]) {
      expect(capacityLabel(k).toLowerCase()).not.toMatch(/limited to|only|restrict|max\b/);
    }
  });
});
