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
