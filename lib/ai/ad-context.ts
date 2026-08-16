import "server-only";
import { storeStatsFor } from "@/lib/analytics/visits";

/*
 * What Ad Studio knows about the business it is advertising.
 *
 * It used to know nothing. It received a store name, a tagline and a product
 * list, and wrote ads from that — competent copy for a catalogue, written by
 * someone who had never seen the traffic. The first question any performance
 * marketer asks is "what are you getting now, and what have you tried?", and
 * Ad Studio could not ask it.
 *
 * The numbers were already in the product; they simply never reached this
 * surface. Nothing new is measured here — this reads the same per-store stats
 * the dashboard renders.
 *
 * The point is not decoration. Traffic and conversion change the ADVICE:
 *   - No traffic at all → the job is reach, and a conversion-led angle is
 *     advice about a problem the merchant does not have yet.
 *   - Traffic but no orders → the ads are working and the store is not, and
 *     spending more is the wrong move.
 *   - Both → there is a real AOV and a real conversion rate to bid against,
 *     and budget advice can stop being a generic range.
 */

export interface AdPerformance {
  visitors7d: number;
  views: number;
  orders7d: number;
  ordersTotal: number;
  revenue7dEUR: number;
  revenueTotalEUR: number;
  /** Null when nobody has visited — undefined, not zero. */
  conversionPct: number | null;
  /** Average order value across all paid orders; null before the first sale. */
  aovEUR: number | null;
  /** False when the stats could not be read at all — distinct from "all zeros". */
  available: boolean;
}

const cents = (n: number) => Math.round(n) / 100;

export async function loadAdPerformance(storeId: string): Promise<AdPerformance> {
  try {
    const stats = (await storeStatsFor([storeId])).get(storeId);
    if (!stats) return unavailable();

    const conversion =
      stats.visitors7d > 0 ? Math.round((stats.orders7d / stats.visitors7d) * 1000) / 10 : null;
    const aov = stats.ordersTotal > 0 ? cents(stats.revenueTotalCents / stats.ordersTotal) : null;

    return {
      visitors7d: stats.visitors7d,
      views: stats.viewsToday,
      orders7d: stats.orders7d,
      ordersTotal: stats.ordersTotal,
      revenue7dEUR: cents(stats.revenue7dCents),
      revenueTotalEUR: cents(stats.revenueTotalCents),
      conversionPct: conversion,
      aovEUR: aov,
      available: true,
    };
  } catch {
    return unavailable();
  }
}

function unavailable(): AdPerformance {
  return {
    visitors7d: 0,
    views: 0,
    orders7d: 0,
    ordersTotal: 0,
    revenue7dEUR: 0,
    revenueTotalEUR: 0,
    conversionPct: null,
    aovEUR: null,
    available: false,
  };
}

/**
 * Render the numbers for the model, with the read already made explicit.
 *
 * The diagnosis line is the part that earns its tokens. Handed raw figures, a
 * model will write plausible advice for the average store; told "nobody has
 * visited, this is a reach problem", it stops proposing conversion tweaks for
 * a problem that does not exist yet.
 */
export function renderAdPerformance(p: AdPerformance): string {
  if (!p.available) {
    return "PERFORMANCE: unavailable — the store's traffic and sales could not be read. Do not guess at numbers; give advice that holds regardless of current performance, and say what you would need to know to sharpen it.";
  }

  const lines = [
    "PERFORMANCE (this store, last 7 days unless stated):",
    `  Visitors: ${p.visitors7d} · Orders: ${p.orders7d} · Revenue: €${p.revenue7dEUR.toFixed(2)}`,
    `  Lifetime: ${p.ordersTotal} paid orders · €${p.revenueTotalEUR.toFixed(2)}`,
    p.conversionPct === null
      ? "  Conversion: no visitors, so there is no rate to read."
      : `  Conversion: ${p.conversionPct}% of visitors bought.`,
    p.aovEUR === null
      ? "  Average order value: no sales yet."
      : `  Average order value: €${p.aovEUR.toFixed(2)}.`,
  ];

  // The three states that should produce genuinely different plans.
  if (p.visitors7d === 0) {
    lines.push(
      "  DIAGNOSIS: nobody has visited this store. This is a REACH problem. Lead with cold-traffic acquisition; do not build a plan around retargeting or lookalike audiences, because there is no audience to model on yet. Budget advice should assume a first test, not a scale-up.",
    );
  } else if (p.ordersTotal === 0) {
    lines.push(
      `  DIAGNOSIS: ${p.visitors7d} visitors and no sales. Traffic is arriving and not converting, so more spend buys more of the same result. Say this plainly in the strategy, and weight the creative toward qualifying the right visitor (price, who it is for, what it is not) rather than maximising clicks.`,
    );
  } else if (p.aovEUR !== null) {
    lines.push(
      `  DIAGNOSIS: this store sells. Bid against the real numbers: at €${p.aovEUR.toFixed(2)} average order value and ${p.conversionPct}% conversion, a click is worth roughly €${((p.aovEUR * (p.conversionPct ?? 0)) / 100).toFixed(2)} before margin. Make the budget advice reflect that ceiling instead of a generic range, and prioritise channels that can be measured against it.`,
    );
  }

  return lines.join("\n");
}
