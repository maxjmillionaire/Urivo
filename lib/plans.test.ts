import { describe, it, expect } from "vitest";
import {
  getPlan,
  monthlyPrice,
  isLaunchWindow,
  nextPlan,
  isPaid,
  canPublish,
  planName,
  formatPrice,
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
    expect(canPublish("free")).toBe(false);
    expect(canPublish("core")).toBe(true);
  });

  it("nextPlan walks free → Founder → Pro → top", () => {
    expect(nextPlan("free")?.key).toBe("core");
    expect(nextPlan("core")?.key).toBe("pro");
    expect(nextPlan("pro")).toBeNull();
  });

  it("customer-facing names + price formatting", () => {
    expect(planName("core")).toBe("Founder");
    expect(planName("pro")).toBe("Pro");
    expect(formatPrice(0)).toBe("€0");
    expect(formatPrice(39)).toBe("€39");
  });
});
