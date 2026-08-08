import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Creative } from "./ad-platforms";

/*
 * The loop.
 *
 * Ad Studio used to generate ads and forget them. This is what turns it from a
 * copywriter into a marketing system: every generated ad is persisted with an
 * id, gets a tracking link, and its clicks and revenue are joined back to it
 * exactly — because Urivo owns the storefront that receives the click and the
 * order that closes the sale.
 *
 * That exactness is the whole point. Everyone else attributes with a pixel
 * that iOS and ad blockers break; Meta's own reporting routinely loses a third
 * of conversions. Here the join is two rows in one database. It cannot be
 * blocked, and it does not need consent for a third-party tracker, because
 * there is no third party.
 *
 * And the numbers do not just get displayed — the next generation reads them.
 * An ad that got 400 clicks and no orders is a lesson; an angle that sold is a
 * pattern to repeat. That is the difference between the second run being a
 * fresh guess and being better than the first.
 */

export interface StoredCreative extends Creative {
  id: string;
  /** The storefront URL that attributes traffic to this ad. */
  trackingUrl: string;
}

/**
 * Persist a generated plan's creatives and hand back their tracking links.
 *
 * Best-effort: if this fails the merchant still gets their ads. Losing
 * attribution is a missing insight; failing the request would be a missing
 * product.
 */
export async function saveCreatives(
  storeId: string,
  subdomain: string,
  creatives: Creative[],
  appUrl: string,
): Promise<StoredCreative[] | null> {
  if (creatives.length === 0) return null;
  const runId = randomUUID();

  try {
    const { data, error } = await supabaseAdmin()
      .from("ad_creatives")
      .insert(
        creatives.map((c) => ({
          store_id: storeId,
          run_id: runId,
          platform: c.platform,
          format: c.format,
          angle: c.angle,
          headline: c.headline,
          primary_text: c.primaryText,
          cta: c.cta,
        })),
      )
      .select("id, headline");
    if (error || !data) return null;

    /*
     * Order is not guaranteed by the insert, so match on the headline rather
     * than by position — a mismatched id would attribute a Meta ad's revenue
     * to a Google one, which is worse than no attribution at all.
     */
    const byHeadline = new Map<string, string>();
    for (const row of data as { id: string; headline: string }[]) {
      if (!byHeadline.has(row.headline)) byHeadline.set(row.headline, row.id);
    }

    return creatives.map((c) => {
      const id = byHeadline.get(c.headline) ?? "";
      return { ...c, id, trackingUrl: trackingUrl(appUrl, subdomain, id) };
    });
  } catch {
    return null;
  }
}

/**
 * The link a merchant pastes into the ad platform.
 *
 * `uc` rather than a UTM soup: one short parameter, and Urivo resolves it to
 * the exact creative. UTM parameters still work for a merchant's own links,
 * but their own ads do not need them.
 */
export function trackingUrl(appUrl: string, subdomain: string, creativeId: string): string {
  const base = appUrl.replace(/\/$/, "");
  try {
    const url = new URL(base);
    // Subdomain hosting in production, path-based locally — mirror whatever
    // the deployment actually serves rather than assuming.
    const host = url.host.startsWith("localhost") || /^\d/.test(url.host)
      ? `${base}/store/${subdomain}`
      : `${url.protocol}//${subdomain}.${url.host}`;
    return creativeId ? `${host}?uc=${creativeId}` : host;
  } catch {
    return `${base}/store/${subdomain}${creativeId ? `?uc=${creativeId}` : ""}`;
  }
}

export interface CreativePerformance {
  creativeId: string;
  runId: string;
  platform: string;
  headline: string;
  angle: string;
  launchedAt: string | null;
  clicks: number;
  orders: number;
  revenueEUR: number;
  /** Null until there is traffic — undefined, not zero. */
  conversionPct: number | null;
  createdAt: string;
}

/**
 * A past ad with everything needed to actually launch it — copy AND link.
 *
 * The performance rows alone were a dead end. A merchant who generated ads on
 * Monday and sat down to put them into Meta on Wednesday had no tracking link
 * anywhere: the links only ever existed in the response to the generation
 * request, so a page reload lost them for good. The only URL still in reach
 * was the plain storefront address — which measures nothing. The interface was
 * quietly teaching the one mistake that breaks the whole loop.
 */
export interface AdLibraryEntry extends CreativePerformance {
  format: string;
  primaryText: string;
  cta: string;
  trackingUrl: string;
}

export async function loadAdPerformanceHistory(storeId: string): Promise<CreativePerformance[]> {
  try {
    const { data, error } = await supabaseAdmin().rpc("ad_performance", { p_store_id: storeId });
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map((r) => {
      const clicks = Number(r.clicks ?? 0);
      const orders = Number(r.orders ?? 0);
      return {
        creativeId: String(r.creative_id),
        runId: String(r.run_id),
        platform: String(r.platform),
        headline: String(r.headline),
        angle: String(r.angle ?? ""),
        launchedAt: (r.launched_at as string | null) ?? null,
        clicks,
        orders,
        revenueEUR: Number(r.revenue_cents ?? 0) / 100,
        conversionPct: clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null,
        createdAt: String(r.created_at),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Every saved ad, with its copy and its tracking link, ready to launch.
 *
 * Two reads rather than one: `ad_performance` for the measured numbers and the
 * creative rows for the copy. Merging in memory keeps this working on the
 * schema already deployed — a merchant should not need another migration to
 * get back a link the product already generated for them.
 */
export async function loadAdLibrary(
  storeId: string,
  subdomain: string,
  appUrl: string,
): Promise<AdLibraryEntry[]> {
  const performance = await loadAdPerformanceHistory(storeId);
  if (performance.length === 0) return [];

  let copy = new Map<string, { format: string; primaryText: string; cta: string }>();
  try {
    const { data } = await supabaseAdmin()
      .from("ad_creatives")
      .select("id, format, primary_text, cta")
      .eq("store_id", storeId);
    copy = new Map(
      ((data ?? []) as Record<string, unknown>[]).map((r) => [
        String(r.id),
        {
          format: String(r.format ?? ""),
          primaryText: String(r.primary_text ?? ""),
          cta: String(r.cta ?? ""),
        },
      ]),
    );
  } catch {
    /* Copy is a nicety; the link is the part that matters. Carry on without it. */
  }

  return performance.map((p) => ({
    ...p,
    format: copy.get(p.creativeId)?.format ?? "",
    primaryText: copy.get(p.creativeId)?.primaryText ?? "",
    cta: copy.get(p.creativeId)?.cta ?? "",
    trackingUrl: trackingUrl(appUrl, subdomain, p.creativeId),
  }));
}

/**
 * How much of this store's revenue the ad numbers actually account for.
 *
 * Spec 10 §14. No ad figure is ever shown alone, because a merchant told
 * "€258 from your ads" concludes their ads produced €258. Told "€258
 * attributed, €340 not attributable, 43% coverage" they reason correctly —
 * and the split says WHICH problem they have: mostly returning customers is
 * a retention business, mostly untracked is a broken link, mostly expired is
 * a slow consideration cycle worth knowing about.
 */
export interface AttributionCoverage {
  attributed: { orders: number; revenueEUR: number };
  /** Known customers. Retention revenue, deliberately not an ad result (§6). */
  returning: { orders: number; revenueEUR: number };
  /** A tracked click exists, but outside the 7-day window (§3). */
  expired: { orders: number; revenueEUR: number };
  /** Direct, organic, cross-device, or an ad launched without a tracked link. */
  unattributed: { orders: number; revenueEUR: number };
  total: { orders: number; revenueEUR: number };
  /** Attributed share of revenue. Null when there is no revenue to divide. */
  coveragePct: number | null;
  days: number;
  /** False when the figure could not be read — distinct from "everything zero". */
  available: boolean;
}

const bucket = (orders: unknown, cents: unknown) => ({
  orders: Number(orders ?? 0),
  revenueEUR: Number(cents ?? 0) / 100,
});

export async function loadAttributionCoverage(
  storeId: string,
  days = 30,
): Promise<AttributionCoverage> {
  const empty = (available: boolean): AttributionCoverage => ({
    attributed: { orders: 0, revenueEUR: 0 },
    returning: { orders: 0, revenueEUR: 0 },
    expired: { orders: 0, revenueEUR: 0 },
    unattributed: { orders: 0, revenueEUR: 0 },
    total: { orders: 0, revenueEUR: 0 },
    coveragePct: null,
    days,
    available,
  });

  try {
    const { data, error } = await supabaseAdmin().rpc("attribution_coverage", {
      p_store_id: storeId,
      p_days: days,
    });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    // A missing RPC means the migration is not applied. Reporting zeros would
    // claim perfect knowledge of nothing; unavailable is the honest answer.
    if (error || !row) return empty(false);

    const attributed = bucket(row.attributed_orders, row.attributed_cents);
    const total = bucket(row.total_orders, row.total_cents);

    return {
      attributed,
      returning: bucket(row.returning_orders, row.returning_cents),
      expired: bucket(row.expired_orders, row.expired_cents),
      unattributed: bucket(row.unattributed_orders, row.unattributed_cents),
      total,
      coveragePct:
        total.revenueEUR > 0
          ? Math.round((attributed.revenueEUR / total.revenueEUR) * 1000) / 10
          : null,
      days,
      available: true,
    };
  } catch {
    return empty(false);
  }
}

/**
 * The one sentence that turns the split into a decision.
 *
 * A coverage figure alone still leaves the merchant to work out what it means.
 * Naming the largest gap tells them which problem they actually have, and the
 * three have nothing to do with each other.
 */
export function explainCoverage(c: AttributionCoverage): string | null {
  if (!c.available || c.total.orders === 0) return null;

  const gaps: [number, string][] = [
    [c.returning.revenueEUR, `most of it is returning customers — that is retention revenue, not an ad result, and it is reported separately on purpose`],
    [c.unattributed.revenueEUR, `most of it arrived without a tracked link — either from somewhere other than your ads, or from an ad pointing at your plain store address`],
    [c.expired.revenueEUR, `most of it came from a tracked ad, but the purchase happened more than 7 days after the click, which is past the window Urivo will credit`],
  ];
  gaps.sort((a, b) => b[0] - a[0]);

  if (c.attributed.revenueEUR === c.total.revenueEUR) {
    return "Every sale in this period is joined to a specific ad.";
  }
  if (gaps[0][0] <= 0) return null;

  return `€${(c.total.revenueEUR - c.attributed.revenueEUR).toFixed(2)} could not be credited to an ad — ${gaps[0][1]}.`;
}

/**
 * Whether the merchant's ads are actually being measured.
 *
 * The tracking link is the one manual step in the chain, and getting it wrong
 * fails silently: the ads run, the traffic arrives, and every ad sits at zero
 * clicks forever. The merchant reads that as "my ads failed" and turns them
 * off, when what failed was the measurement. Nothing else in the product can
 * tell them apart — so this does, out of numbers already on hand.
 *
 * It states a fact and a condition rather than an accusation, because Urivo
 * cannot know whether the ads are live. A store with organic traffic and no
 * campaign running is not doing anything wrong, and must not be told it is.
 */
export interface TrackingGap {
  tone: "warn" | "ok";
  title: string;
  detail: string;
}

/** Old enough that a launched ad would have been clicked by now. */
const SETTLE_MS = 6 * 60 * 60 * 1000;
/** Below this, "no tracked clicks" means no traffic, not broken tracking. */
const MIN_VISITORS = 20;

export function detectTrackingGap(
  library: Pick<CreativePerformance, "clicks" | "createdAt">[],
  visitors7d: number,
  now: number = Date.now(),
): TrackingGap | null {
  if (library.length === 0) return null;

  const settled = library.filter((c) => now - Date.parse(c.createdAt) > SETTLE_MS);
  if (settled.length === 0) return null; // Too soon to read anything into a zero.

  const clicks = library.reduce((sum, c) => sum + c.clicks, 0);

  if (clicks > 0) {
    return {
      tone: "ok",
      title: "Your ads are being measured.",
      detail: `${clicks} tracked ${clicks === 1 ? "click" : "clicks"} joined to a specific ad so far. Every sale that follows one is credited exactly, and the next plan you generate reads these results.`,
    };
  }

  // No tracked clicks, but people are arriving. Something untagged is sending
  // them — and if a campaign is running, it is pointing at the wrong URL.
  if (visitors7d >= MIN_VISITORS) {
    return {
      tone: "warn",
      title: "Traffic is arriving, but none of it is tagged.",
      /*
       * Points at the results table, not at a generated ad card: this warning
       * is most often read on a page with no fresh plan on it, and an
       * instruction that refers to something not on screen is worse than none.
       */
      detail: `${visitors7d} visitors in the last 7 days and not one came through a tracked link. If you have ads running, they are pointing at your plain store address, so nothing can be measured — copy a link from the table below into your campaign and results will start appearing here. If your visitors come from somewhere else, this is nothing to fix.`,
    };
  }

  return null;
}

/**
 * What the model is told about the ads this store has already run.
 *
 * Only ads with real traffic are included. A list of twenty untested
 * headlines is noise that costs tokens and teaches nothing; ten clicks is the
 * floor at which a result means anything at all, and even that is stated as
 * weak evidence so the model does not over-fit to one lucky ad.
 */
export function renderAdHistory(history: CreativePerformance[]): string | null {
  const tested = history.filter((h) => h.clicks >= 10);
  if (tested.length === 0) return null;

  const winners = tested.filter((h) => h.orders > 0).sort((a, b) => b.revenueEUR - a.revenueEUR);
  const losers = tested.filter((h) => h.orders === 0).sort((a, b) => b.clicks - a.clicks);

  const lines = ["PAST ADS FOR THIS STORE — measured, not modelled. Learn from these."];

  if (winners.length > 0) {
    lines.push("", "WORKED:");
    for (const w of winners.slice(0, 5)) {
      lines.push(
        `  [${w.platform}] "${w.headline}" — angle: ${w.angle} · ${w.clicks} clicks, ${w.orders} orders, €${w.revenueEUR.toFixed(2)} (${w.conversionPct}%)`,
      );
    }
  }

  if (losers.length > 0) {
    lines.push("", "DID NOT CONVERT:");
    for (const l of losers.slice(0, 5)) {
      lines.push(`  [${l.platform}] "${l.headline}" — angle: ${l.angle} · ${l.clicks} clicks, 0 orders`);
    }
  }

  lines.push(
    "",
    winners.length > 0
      ? "Repeat what the winning angles have in common — do not simply reprint the same headlines. Treat the failures as answered questions and do not re-ask them."
      : "Nothing has converted yet. The angles above have been tested and did not work; propose genuinely different ones rather than variations of them.",
    "Sample sizes here are small. Treat them as evidence, not proof, and say so if you lean on one.",
  );

  return lines.join("\n");
}
