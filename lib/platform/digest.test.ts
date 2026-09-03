import { describe, it, expect } from "vitest";
import { composeContent, type DigestRow } from "./digest";

/*
 * The digest's value is choosing the single most useful thing to say. These
 * lock the priority ladder: sale > paused store > expiring credits > low
 * balance > healthy growth nudge, plus the always-on stat grid.
 */

const base: DigestRow = {
  user_id: "u1",
  email: "m@example.com",
  full_name: "Max Basner",
  marketing_unsub_token: "tok-1",
  credit_balance: 200,
  credits_expiring_amount: 0,
  credits_expiring_at: null,
  stores_total: 1,
  stores_live: 1,
  stores_new: 0,
  products_total: 6,
  orders_week: 0,
  revenue_week_cents: 0,
  orders_total: 0,
  revenue_total_cents: 0,
};

const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const far = () => new Date(Date.now() + 60 * 86_400_000).toISOString();

describe("composeContent — nudge priority", () => {
  it("a sale this week wins over everything, even a paused second store", () => {
    const c = composeContent({
      ...base,
      stores_total: 2,
      stores_live: 1,
      orders_week: 3,
      revenue_week_cents: 8990,
      credits_expiring_amount: 50,
      credits_expiring_at: soon(),
    });
    expect(c.headline).toContain("3 sales this week");
    expect(c.headline).toContain("€89.90");
    // Uses the first name only.
    expect(c.name).toBe("Max");
  });

  it("no live store is the top blocker when there are no sales", () => {
    const c = composeContent({ ...base, stores_total: 2, stores_live: 0 });
    expect(c.ctaLabel).toBe("Publish a store");
    expect(c.headline).toContain("none are");
  });

  it("singular copy for a single paused store", () => {
    const c = composeContent({ ...base, stores_total: 1, stores_live: 0 });
    expect(c.headline).toContain("1 store");
    expect(c.headline).toContain("it isn't");
  });

  it("expiring credits nudge when live, no sales, credits expiring soon", () => {
    const c = composeContent({
      ...base,
      credits_expiring_amount: 120,
      credits_expiring_at: soon(),
    });
    expect(c.ctaLabel).toBe("Use your credits");
    expect(c.headline).toContain("120");
  });

  it("a far-off expiry does NOT trigger the expiry nudge", () => {
    const c = composeContent({
      ...base,
      credits_expiring_amount: 120,
      credits_expiring_at: far(),
    });
    expect(c.ctaLabel).not.toBe("Use your credits");
  });

  it("low balance routes to top-up", () => {
    const c = composeContent({ ...base, credit_balance: 5 });
    expect(c.ctaLabel).toBe("Top up credits");
    expect(c.ctaPath).toBe("/dashboard/billing");
  });

  it("healthy + live + no sales gets the growth nudge", () => {
    const c = composeContent(base);
    expect(c.headline).toContain("live");
    expect(c.ctaPath).toBe("/dashboard");
  });

  it("always includes the core stat grid; revenue only when there were sales", () => {
    const dry = composeContent(base);
    expect(dry.stats.map((s) => s.label)).toEqual(["Stores live", "Products", "Credits"]);

    const wet = composeContent({ ...base, orders_week: 2, revenue_week_cents: 4000 });
    expect(wet.stats.map((s) => s.label)).toContain("Revenue this week");
    expect(wet.stats.find((s) => s.label === "Revenue this week")?.value).toBe("€40.00");
  });

  it("falls back gracefully when the name is missing", () => {
    const c = composeContent({ ...base, full_name: null });
    expect(c.name).toBeUndefined();
  });
});
