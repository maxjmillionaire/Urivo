import { describe, it, expect } from "vitest";
import {
  getPlan,
  maxMonthlyOrders,
  volumeStanding,
  volumeMessage,
  priceForInterval,
  annualMonthsFree,
  annualSavingEur,
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

/*
 * Annual billing exists for cash and churn, but the number a customer checks is
 * "two months free". If that stops being true the offer stops being credible,
 * so it is asserted rather than assumed.
 */
describe("annual billing", () => {
  it("prices a year at ten months — two months free, on every paid plan", () => {
    for (const key of ["core", "pro"] as const) {
      expect(annualMonthsFree(key)).toBe(2);
      expect(getPlan(key).price.annual).toBe(getPlan(key).price.regular * 10);
    }
  });

  it("states a saving the customer can verify in their head", () => {
    expect(annualSavingEur("core")).toBe(49 * 12 - 490);
    expect(annualSavingEur("pro")).toBe(199 * 12 - 1990);
  });

  it("never compounds the founding lock with the annual price", () => {
    // Founding is a MONTHLY lifetime rate. Stacking it onto a year paid up
    // front would hand over the tier for a fraction of its price.
    const founding = priceForInterval("core", "year", "founding");
    expect(founding).toBe(getPlan("core").price.annual);
    expect(founding).toBeGreaterThan(getPlan("core").price.founding! * 10);
  });

  it("leaves monthly pricing exactly as it was", () => {
    expect(priceForInterval("core", "month", null)).toBe(49);
    expect(priceForInterval("pro", "month", null)).toBe(199);
  });

  it("keeps a year cheaper than twelve months, always", () => {
    for (const key of ["core", "pro"] as const) {
      expect(priceForInterval(key, "year")).toBeLessThan(getPlan(key).price.regular * 12);
    }
  });

  it("reports no saving for a free plan rather than dividing by zero", () => {
    expect(annualSavingEur("free")).toBe(0);
    expect(annualMonthsFree("free")).toBe(0);
  });
});

/*
 * Order volume moves a merchant up a tier. It is NOT a take rate, and the
 * distinction is the whole point: a percentage grows forever and punishes the
 * merchants who succeed, a tier is capped so success gets proportionally
 * cheaper. At €5k a month Founder is ~4% of revenue; at €50k it is ~0.4%.
 */
describe("order volume tiering", () => {
  it("carries a real business on Founder before asking anything", () => {
    // 100 orders at a €50 average is ~€5,000 a month. A merchant below that is
    // still building and must never be interrupted.
    expect(maxMonthlyOrders("core")).toBe(100);
    expect(volumeStanding("core", 40)).toBe("fine");
    expect(volumeStanding("core", 79)).toBe("fine");
  });

  it("warns before it arrives, never on the day", () => {
    expect(volumeStanding("core", 80)).toBe("approaching");
    expect(volumeStanding("core", 99)).toBe("approaching");
    expect(volumeStanding("core", 100)).toBe("over");
  });

  it("never asks a merchant who has not sold anything", () => {
    // The north star is the FIRST sale. Nothing about volume may touch the
    // path to it.
    for (const plan of ["free", "core", "pro"]) {
      expect(volumeStanding(plan, 0)).toBe("fine");
      expect(volumeMessage(plan, 0)).toBeNull();
    }
  });

  it("leaves Pro uncapped, so success is never a bill", () => {
    expect(maxMonthlyOrders("pro")).toBeNull();
    expect(volumeStanding("pro", 100_000)).toBe("fine");
    expect(volumeMessage("pro", 100_000)).toBeNull();
  });

  it("climbs the ladder monotonically", () => {
    const rank = (k: string) => maxMonthlyOrders(k) ?? Number.POSITIVE_INFINITY;
    expect(rank("core")).toBeGreaterThan(rank("free"));
    expect(rank("pro")).toBeGreaterThan(rank("core"));
  });

  it("congratulates the volume rather than scolding it", () => {
    const msg = volumeMessage("core", 140)!;
    expect(msg.title).toContain("140 orders");
    // Selling never stops, and the merchant is told so in the same breath.
    expect(msg.detail.toLowerCase()).toContain("nothing stops");
    expect(`${msg.title} ${msg.detail}`.toLowerCase()).not.toMatch(
      /exceed|violat|limit reached|blocked|suspend|overage|penalt/,
    );
  });

  it("names what the next tier carries, so the decision is obvious", () => {
    expect(volumeMessage("free", 30)!.detail).toContain("100");
    expect(volumeMessage("core", 120)!.detail.toLowerCase()).toContain("unlimited");
  });
});

/*
 * The invariant that makes this defensible at all. Refusing a merchant's
 * customer to force an upgrade would take money out of their pocket — strictly
 * worse than the take rate we declined to charge.
 */
describe("volume never blocks a sale", () => {
  it("is not consulted anywhere on the checkout path", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const paths = [
      "../app/api/store/[subdomain]/checkout/route.ts",
      "../lib/commerce/checkout.ts",
      "../lib/commerce/readiness.ts",
    ];
    for (const rel of paths) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src, `${rel} must not read order volume`).not.toMatch(
        /maxMonthlyOrders|volumeStanding|monthly_paid_orders/,
      );
    }
  });
});
