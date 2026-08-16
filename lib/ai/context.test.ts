import { describe, it, expect } from "vitest";
import { renderContext, type AssistantContext } from "./context";

/*
 * The snapshot is what separates Ask Urivo from a general chatbot, so what it
 * says about ITSELF matters as much as the numbers.
 *
 * The failure that motivated these tests: a `select` naming a column the
 * environment had not migrated yet returned no rows, the loader read that as
 * "no stores", and the assistant confidently told a founder with three live
 * stores that they had none — and built a whole plan on it. Silence about a
 * failure is worse than the failure.
 */

const account = { plan: "Founder", credits: 40, storeCount: 3, canTakePayments: false };

const store: NonNullable<AssistantContext["store"]> = {
  id: "s1",
  name: "Nordwerk",
  subdomain: "nordwerk",
  tagline: "Tools that outlive the person who bought them.",
  isLive: true,
  publishedAt: "2026-07-01T00:00:00.000Z",
  createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  palette: { background: "#14161A", ink: "#F2F0EC", accent: "#C9772F" },
  fonts: { heading: "sans", body: "sans" },
  personality: "Industrial, precise, unsentimental",
  sections: ["hero", "story", "trust", "collection", "footer"],
  products: [{ title: "Bench Chisel — 12mm", description: "Cryo-treated steel.", priceEUR: 89 }],
  productCount: 4,
};

describe("renderContext when the snapshot could not be read", () => {
  const out = renderContext({ store: null, metrics: null, account, unavailable: true });

  it("tells the model it is blind rather than that nothing exists", () => {
    expect(out).toMatch(/could NOT be loaded/);
    expect(out).toMatch(/Do not state or imply that they have no store/);
  });

  it("never claims the account has no store", () => {
    expect(out).not.toMatch(/No store yet/);
  });
});

describe("renderContext for an account with genuinely no store", () => {
  const out = renderContext({ store: null, metrics: null, account: { ...account, storeCount: 0 } });

  it("says so, and does not claim a loading failure", () => {
    expect(out).toMatch(/No store yet — this account genuinely has none/);
    expect(out).not.toMatch(/could NOT be loaded/);
  });
});

describe("renderContext for a real store", () => {
  it("states an unfinished Stripe connection as a hard blocker", () => {
    const out = renderContext({ store, metrics: null, account });
    expect(out).toMatch(/cannot accept a payment yet/);
  });

  it("confirms payments when Stripe is connected", () => {
    const out = renderContext({ store, metrics: null, account: { ...account, canTakePayments: true } });
    expect(out).toMatch(/Stripe connected/);
    expect(out).not.toMatch(/cannot accept a payment yet/);
  });

  it("flags a draft store as the thing blocking everything else", () => {
    const out = renderContext({ store: { ...store, isLive: false }, metrics: null, account });
    expect(out).toMatch(/DRAFT/);
    expect(out).toMatch(/Nothing else matters until this is live/);
  });

  it("names an empty catalogue plainly", () => {
    const out = renderContext({
      store: { ...store, products: [], productCount: 0 },
      metrics: null,
      account,
    });
    expect(out).toMatch(/there is nothing to buy/);
  });

  it("calls no traffic a traffic problem, not a conversion problem", () => {
    const out = renderContext({
      store,
      metrics: {
        visits30d: 0, visitors30d: 0, orders30d: 0, revenue30dEUR: 0,
        ordersLifetime: 0, revenueLifetimeEUR: 0, conversionPct: null,
      },
      account,
    });
    expect(out).toMatch(/traffic problem, not a store problem/);
    expect(out).not.toMatch(/still no first sale/);
  });

  it("calls traffic without a sale a conversion gap", () => {
    const out = renderContext({
      store,
      metrics: {
        visits30d: 640, visitors30d: 214, orders30d: 0, revenue30dEUR: 0,
        ordersLifetime: 0, revenueLifetimeEUR: 0, conversionPct: 0,
      },
      account,
    });
    expect(out).toMatch(/214 visitors and still no first sale/);
    expect(out).not.toMatch(/traffic problem/);
  });

  it("passes real figures through verbatim so they can be quoted", () => {
    const out = renderContext({
      store,
      metrics: {
        visits30d: 640, visitors30d: 214, orders30d: 3, revenue30dEUR: 267,
        ordersLifetime: 11, revenueLifetimeEUR: 984.5, conversionPct: 1.4,
      },
      account,
    });
    expect(out).toContain("640 page views from 214 visitors");
    expect(out).toContain("€267.00");
    expect(out).toContain("11 paid orders · €984.50");
    expect(out).toContain("1.4% of visitors bought");
  });

  it("instructs against inventing numbers alongside the real ones", () => {
    const out = renderContext({
      store,
      metrics: {
        visits30d: 1, visitors30d: 1, orders30d: 0, revenue30dEUR: 0,
        ordersLifetime: 0, revenueLifetimeEUR: 0, conversionPct: 0,
      },
      account,
    });
    expect(out).toMatch(/never invent others/);
  });
});
