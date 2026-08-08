import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderAdHistory, trackingUrl, detectTrackingGap, type CreativePerformance } from "./ad-performance";

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

  it("checkout takes the session from the cookie, never from the page", () => {
    /*
     * Spec 10 §2/§16.7. The session is HttpOnly and server-issued precisely so
     * that it cannot be forged: a client-supplied id could be set to a stranger's
     * value to attach their checkout to someone else's click, or replayed to
     * inflate an ad. The request body is a fallback for pages served before the
     * cookie existed, and the cookie must win.
     */
    const checkout = read("app/api/store/[subdomain]/checkout/route.ts");
    expect(checkout).toMatch(/request\.cookies\.get\("urivo_cs"\)/);
    expect(checkout).toMatch(/SESSION_ID\.test\(cookieSession \?\? ""\) \? cookieSession : body\.sid/);
    expect(checkout).toMatch(/sid: sessionId/);
  });

  it("the session outlives the browser tab", () => {
    /*
     * The failure this replaces: the id lived in sessionStorage, so attribution
     * ended when the tab closed. Every considered purchase — click today, buy
     * tomorrow — was reported as zero next to the ad that caused it, and a
     * merchant switching off a working ad never saw an error.
     */
    const mw = read("middleware.ts");
    expect(mw).toMatch(/httpOnly: true/);
    expect(mw).toMatch(/sameSite: "lax"/); // still sent on the ad click itself
    expect(mw).toMatch(/COMMERCE_SESSION_MAX_AGE = 7 \* 24 \* 60 \* 60/);
    expect(mw).toMatch(/withCommerceSession\(request, NextResponse\.rewrite\(url\)\)/);
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

describe("the tracked link is reachable after the plan that produced it is gone", () => {
  const ROOT = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("the ads endpoint hands back a link for every saved ad, not just fresh ones", () => {
    /*
     * Ads get written in one sitting and launched in another. When the links
     * lived only in the generation response, a merchant returning the next day
     * had no tracked URL at all — so they pasted their plain store address and
     * the entire measurement chain silently did nothing.
     */
    const route = read("app/api/stores/[id]/ads/route.ts");
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    expect(get).toMatch(/loadAdLibrary/);
    expect(get).toMatch(/detectTrackingGap/);
  });

  it("the results table can actually copy the link, so it survives a reload", () => {
    const ui = read("app/(platform)/dashboard/ads/ad-studio.tsx");
    const start = ui.indexOf("Your ads — links and results");
    const end = ui.indexOf("{plan && (");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Rendering the URL somewhere is not enough — the button has to copy it.
    expect(ui.slice(start, end)).toMatch(/copy\(c\.trackingUrl/);
  });

  it("copying the whole ad includes the destination URL", () => {
    // The lazy path and the correct path have to be the same path.
    const ui = read("app/(platform)/dashboard/ads/ad-studio.tsx");
    expect(ui).toMatch(/Website URL: \$\{ad\.trackingUrl\}/);
  });

  it("says plainly that the plain store address will not do", () => {
    const ui = read("app/(platform)/dashboard/ads/ad-studio.tsx");
    expect(ui).toMatch(/not your plain store address/i);
  });
});

describe("a silently broken tracking setup gets named", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-08-08T12:00:00Z");
  const ad = (clicks: number, ageHours: number) => ({
    clicks,
    createdAt: new Date(NOW - ageHours * HOUR).toISOString(),
  });

  it("stays quiet when no ad has been generated", () => {
    expect(detectTrackingGap([], 500, NOW)).toBeNull();
  });

  it("stays quiet while the ads are too fresh to have been clicked", () => {
    // Zero clicks an hour after generating means nothing at all.
    expect(detectTrackingGap([ad(0, 1)], 500, NOW)).toBeNull();
  });

  it("stays quiet when there is simply no traffic to explain", () => {
    // No visitors and no clicks is a reach problem, not a tracking problem.
    // Telling this merchant to fix their links would send them after the wrong bug.
    expect(detectTrackingGap([ad(0, 48)], 3, NOW)).toBeNull();
  });

  it("speaks up when visitors arrive but nothing is tagged", () => {
    const gap = detectTrackingGap([ad(0, 48)], 340, NOW)!;
    expect(gap.tone).toBe("warn");
    expect(gap.detail).toMatch(/340 visitors/);
    expect(gap.detail).toMatch(/plain store address/i);
  });

  it("points at something that is actually on the page", () => {
    /*
     * This warning is usually read without a freshly generated plan on screen,
     * so it must send the merchant to the results table — which is always
     * there — rather than to an ad card that may not be.
     */
    const gap = detectTrackingGap([ad(0, 48)], 340, NOW)!;
    expect(gap.detail).toMatch(/table below/i);
    expect(gap.detail).not.toMatch(/the ad below/i);
  });

  it("does not accuse a merchant whose traffic is simply organic", () => {
    // Urivo cannot see whether a campaign is running, so it must not assert one is.
    const gap = detectTrackingGap([ad(0, 48)], 340, NOW)!;
    expect(gap.detail).toMatch(/if you have ads running/i);
    expect(gap.detail).toMatch(/nothing to fix/i);
  });

  it("confirms the setup once a tracked click lands", () => {
    const gap = detectTrackingGap([ad(12, 48)], 340, NOW)!;
    expect(gap.tone).toBe("ok");
    expect(gap.detail).toMatch(/12 tracked clicks/);
  });

  it("counts one click as a click, not '1 clicks'", () => {
    expect(detectTrackingGap([ad(1, 48)], 340, NOW)!.detail).toMatch(/1 tracked click\b/);
  });
});

describe("recording a visit survives a database that is one migration behind", () => {
  it("steps back one migration at a time instead of straight to the floor", () => {
    const visits = readFileSync(join(__dirname, "..", "analytics", "visits.ts"), "utf8");
    /*
     * Naming a column that does not exist rejects the whole insert, and the
     * store silently stops recording traffic. Losing attribution is an insight;
     * losing the visit is a broken metric on the merchant's dashboard.
     *
     * Two steps, not one: a database with 0038 but not 0039 keeps its
     * attribution rather than losing it alongside the bot flag.
     */
    expect(visits).toMatch(/insert\(\{ \.\.\.base, creative_id, utm_campaign, utm_source \}\)/);
    expect(visits).toMatch(/if \(legacy\) await admin\.from\("store_visits"\)\.insert\(base\)/);
  });

  it("never records a bot on a database that cannot flag it as one", () => {
    /*
     * Without the is_bot column there is nowhere to put the flag, and inserting
     * the row anyway would file a crawler as a human — the exact number spec 10
     * §13 exists to keep clean. Skipping the row is the honest degradation.
     */
    const visits = readFileSync(join(__dirname, "..", "analytics", "visits.ts"), "utf8");
    expect(visits).toMatch(/if \(input\.isBot\) return;/);
  });
});
