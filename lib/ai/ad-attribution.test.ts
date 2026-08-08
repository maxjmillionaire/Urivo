import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderAdHistory, trackingUrl, type CreativePerformance } from "./ad-performance";

/*
 * Ad attribution — the loop that turns a generator into a marketing system.
 *
 * The cases here guard the two ways this can be worse than useless: telling a
 * merchant an ad worked when the sample proves nothing, and teaching the next
 * generation from noise.
 */

const perf = (over: Partial<CreativePerformance> = {}): CreativePerformance => ({
  creativeId: "c1",
  runId: "r1",
  platform: "Meta",
  headline: "Buy once, keep forever",
  angle: "buy-it-for-life",
  launchedAt: null,
  clicks: 100,
  orders: 3,
  revenueEUR: 258,
  conversionPct: 3,
  createdAt: "2026-08-01T00:00:00Z",
  ...over,
});

describe("only tested ads teach the next generation", () => {
  it("says nothing at all when no ad has real traffic", () => {
    // A list of untested headlines costs tokens and teaches nothing.
    expect(renderAdHistory([])).toBeNull();
    expect(renderAdHistory([perf({ clicks: 0, orders: 0 })])).toBeNull();
    expect(renderAdHistory([perf({ clicks: 9, orders: 0 })])).toBeNull();
  });

  it("includes an ad once it clears the evidence floor", () => {
    expect(renderAdHistory([perf({ clicks: 10, orders: 1 })])).not.toBeNull();
  });

  it("separates what sold from what did not", () => {
    const out = renderAdHistory([
      perf({ creativeId: "win", headline: "Sold well", clicks: 200, orders: 6 }),
      perf({ creativeId: "lose", headline: "Nobody bought", clicks: 400, orders: 0, revenueEUR: 0 }),
    ])!;
    expect(out).toMatch(/WORKED:/);
    expect(out).toMatch(/DID NOT CONVERT:/);
    // The failure has to be named, or the next run happily proposes it again.
    expect(out.indexOf("Sold well")).toBeLessThan(out.indexOf("Nobody bought"));
  });

  it("tells the model to generalise the winners, not reprint them", () => {
    const out = renderAdHistory([perf({ clicks: 200, orders: 6 })])!;
    expect(out).toMatch(/what the winning angles have in common/i);
    expect(out).toMatch(/not simply reprint/i);
  });

  it("changes its instruction when nothing has converted", () => {
    const out = renderAdHistory([perf({ clicks: 500, orders: 0, revenueEUR: 0 })])!;
    // "Repeat the winners" would be nonsense here — there are none.
    expect(out).toMatch(/Nothing has converted yet/i);
    expect(out).toMatch(/genuinely different/i);
  });

  it("always warns that the sample is small", () => {
    // Three orders is a hint, not a law. Without this the model writes a whole
    // strategy around one lucky ad.
    const out = renderAdHistory([perf({ clicks: 200, orders: 6 })])!;
    expect(out).toMatch(/evidence, not proof/i);
  });
});

describe("tracking links point at the store the merchant actually has", () => {
  it("uses the subdomain in production", () => {
    expect(trackingUrl("https://urivo.ai", "nordwerk", "abc-123")).toBe(
      "https://nordwerk.urivo.ai?uc=abc-123",
    );
  });

  it("falls back to the path form on localhost, where subdomains do not resolve", () => {
    expect(trackingUrl("http://localhost:3000", "nordwerk", "abc-123")).toBe(
      "http://localhost:3000/store/nordwerk?uc=abc-123",
    );
  });

  it("still returns a usable store link when the creative could not be saved", () => {
    // Losing attribution must not lose the merchant their link.
    expect(trackingUrl("https://urivo.ai", "nordwerk", "")).toBe("https://nordwerk.urivo.ai");
  });
});

describe("the chain from click to sale is complete", () => {
  const ROOT = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("the storefront reads the ad id off the link", () => {
    expect(read("app/(store)/store/[subdomain]/visit-beacon.tsx")).toMatch(/params\.get\("uc"\)/);
  });

  it("the visit is recorded with it", () => {
    expect(read("app/api/track/route.ts")).toMatch(/creativeId: uc/);
  });

  it("checkout carries the session forward", () => {
    // Without this the sale can never be joined back to the click.
    expect(read("app/(store)/store/[subdomain]/cart/store-cart.tsx")).toMatch(/sid: readSessionId\(\)/);
    expect(read("app/api/store/[subdomain]/checkout/route.ts")).toMatch(/sid: body\.sid/);
  });

  it("the webhook attributes the order after payment clears", () => {
    const orders = read("lib/commerce/orders.ts");
    expect(orders).toMatch(/attribute_order/);
    // Attribution must never be able to fail the order it is describing.
    expect(orders.indexOf("ORDER_INSERT_FAILED")).toBeLessThan(orders.indexOf("attribute_order"));
  });

  it("attribution is first touch, not last", () => {
    const sql = read("supabase/migrations/0038_ad_attribution.sql");
    const fn = sql.slice(sql.indexOf("function public.attribute_order"));
    // Last touch would hand every sale to whatever retargeting ad ran last.
    expect(fn).toMatch(/order by v\.created_at asc/);
    expect(fn).toMatch(/limit 1/);
  });

  it("counts a click as a session, not a pageview", () => {
    const sql = read("supabase/migrations/0038_ad_attribution.sql");
    // Counting reloads would make every ad look several times better than it is.
    expect(sql).toMatch(/count\(distinct v\.session_hash\)/);
  });

  it("keeps the traffic history when an ad is deleted", () => {
    const sql = read("supabase/migrations/0038_ad_attribution.sql");
    const visits = sql.slice(sql.indexOf("alter table public.store_visits"));
    expect(visits).toMatch(/on delete set null/);
  });
});

describe("recording a visit survives a database that is one migration behind", () => {
  it("falls back to the columns that have always existed", () => {
    const visits = readFileSync(join(__dirname, "..", "analytics", "visits.ts"), "utf8");
    /*
     * Naming a column that does not exist rejects the whole insert, and the
     * store silently stops recording traffic. Losing attribution is an insight;
     * losing the visit is a broken metric on the merchant's dashboard.
     */
    expect(visits).toMatch(/if \(error\) await admin\.from\("store_visits"\)\.insert\(base\)/);
  });
});
