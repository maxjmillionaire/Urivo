/*
 * Supplier Intelligence — the Urivo Score.
 *
 * Turns a raw supplier product into a single 0–100 opportunity score with a star
 * rating and plain-English reasons. This is the differentiator: users don't pick
 * from thousands of products, they pick from the best opportunities.
 *
 * Deterministic and transparent — every point traces to a real signal, so we can
 * always explain *why* a product scored what it did (and defend it). Missing
 * signals don't punish a product: their weight is redistributed across the
 * signals we do have, and `confidence` reports how complete the picture is.
 *
 * Pure + isomorphic — the UI renders the score directly; no server needed.
 */

import type { SupplierProduct, SupplierSignals, LearnedSignals, Money } from "./types";

export interface ScoreSignalBreakdown {
  key: "margin" | "shipping" | "trust" | "refunds" | "trend";
  label: string;
  /** 0–1 normalised strength of this signal. */
  value: number;
  weight: number;
  present: boolean;
  reason?: string; // shown when the signal is strong
}

export interface UrivoScore {
  score: number; // 0–100
  stars: number; // 1–5
  /** 0–1: fraction of signal weight actually backed by data. */
  confidence: number;
  reasons: string[]; // top positive reasons, best first
  breakdown: ScoreSignalBreakdown[];
}

// Base weights (sum to 1). Margin and EU shipping lead — they drive real DTC
// success; trust and refunds protect the merchant; trend is a tie-breaker.
const WEIGHTS = { margin: 0.3, shipping: 0.25, trust: 0.2, refunds: 0.15, trend: 0.1 } as const;

const EU = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV",
  "LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Margin % between a cost and a retail price, or null if not computable. */
export function marginPct(cost: Money | null | undefined, retail: Money | null | undefined): number | null {
  if (!cost || !retail || retail.amount <= 0) return null;
  // Assumes same currency (import converts to EUR first); guard anyway.
  if (cost.currency !== retail.currency) return null;
  return ((retail.amount - cost.amount) / retail.amount) * 100;
}

/**
 * Score a product. `targetRetail` is Urivo's intended selling price (from the
 * AI-generated catalogue); it falls back to the vendor's suggested retail.
 */
export function scoreSupplierProduct(
  product: SupplierProduct,
  targetRetail?: Money | null,
  learned?: LearnedSignals | null,
): UrivoScore {
  const s: SupplierSignals = product.signals ?? {};
  const retail = targetRetail ?? product.suggestedRetail ?? null;

  const parts: ScoreSignalBreakdown[] = [];

  // ── Margin ──────────────────────────────────────────────────────────────
  {
    const m = marginPct(product.fromCost, retail);
    const present = m != null;
    // 25% → 0, 70% → 1 (a sweet-spot curve for DTC).
    const value = present ? clamp01((m! - 25) / 45) : 0;
    parts.push({
      key: "margin", label: "Margin", weight: WEIGHTS.margin, present, value,
      reason: present && value >= 0.55 ? `High margin (${Math.round(m!)}%)` : undefined,
    });
  }

  // ── Shipping (EU-centric) ───────────────────────────────────────────────
  {
    const days = s.shippingDaysMax ?? s.shippingDaysMin ?? null;
    const euBonus = s.shipsFromCountry && EU.has(s.shipsFromCountry) ? 0.2 : 0;
    const present = days != null || !!s.shipsFromCountry;
    // ≤5 days → 1, ≥20 days → 0, plus a ships-from-EU bump.
    const base = days != null ? clamp01((20 - days) / 15) : 0.4;
    const value = clamp01(base + euBonus);
    const label =
      days != null
        ? `${s.shippingDaysMin ?? days}–${s.shippingDaysMax ?? days} days`
        : "EU warehouse";
    parts.push({
      key: "shipping", label: "Shipping", weight: WEIGHTS.shipping, present, value,
      reason: present && value >= 0.6 ? `Fast${euBonus ? " EU" : ""} shipping (${label})` : undefined,
    });
  }

  // ── Trust (rating × volume) ─────────────────────────────────────────────
  {
    const hasRating = s.supplierRating != null;
    const hasVol = s.ordersCount != null;
    const present = hasRating || hasVol;
    const ratingV = hasRating ? clamp01(s.supplierRating! / 5) : 0.5;
    // Popularity, log-scaled: 0 orders → 0, ~10k+ → 1.
    const volV = hasVol ? clamp01(Math.log10(Math.max(1, s.ordersCount!)) / 4) : 0.5;
    const value = hasRating && hasVol ? ratingV * 0.6 + volV * 0.4 : hasRating ? ratingV : volV;
    parts.push({
      key: "trust", label: "Supplier trust", weight: WEIGHTS.trust, present, value,
      reason:
        present && value >= 0.7
          ? hasRating
            ? `Trusted supplier (${s.supplierRating!.toFixed(1)}★)`
            : "Trusted supplier"
          : undefined,
    });
  }

  // ── Refunds (lower is better) — measured platform data overrides the estimate ─
  {
    const measured = learned?.refundRatePct;
    const rate = measured ?? s.refundRatePct;
    const present = rate != null;
    // 0% → 1, ≥10% → 0.
    const value = present ? clamp01((10 - rate!) / 10) : 0;
    parts.push({
      key: "refunds", label: "Refund rate", weight: WEIGHTS.refunds, present, value,
      reason:
        present && value >= 0.7
          ? `Low refund rate (${rate!.toFixed(1)}%${measured != null ? " · measured" : ""})`
          : undefined,
    });
  }

  // ── Category trend ──────────────────────────────────────────────────────
  {
    const map = { declining: 0.15, steady: 0.5, rising: 0.8, hot: 1 } as const;
    const present = s.categoryTrend != null;
    const value = present ? map[s.categoryTrend!] : 0;
    parts.push({
      key: "trend", label: "Category trend", weight: WEIGHTS.trend, present, value,
      reason:
        present && value >= 0.8
          ? s.categoryTrend === "hot" ? "Trending category (hot)" : "Trending category"
          : undefined,
    });
  }

  // Missing signals are treated as NEUTRAL risk (0.5), never ignored. An unknown
  // shipping/refund/trust profile is a real risk, so a product we can't fully
  // validate must not outrank one we can. `confidence` reports how much we
  // actually know. (Weights sum to 1, so the weighted sum is already 0–1.)
  const NEUTRAL = 0.5;
  const weighted = parts.reduce((a, p) => a + (p.present ? p.value : NEUTRAL) * p.weight, 0);
  const score100 = Math.round(weighted * 100);

  let confidence = Number(
    parts.filter((p) => p.present).reduce((a, p) => a + p.weight, 0).toFixed(2),
  ); // present weight = coverage
  const reasons = parts
    .filter((p) => p.reason)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .map((p) => p.reason!) as string[];

  // ── Merchant Intelligence blend ──────────────────────────────────────────
  // With real platform outcomes, a MEASURED-performance score progressively
  // takes over from the public estimate. learnedWeight grows with sample size
  // (0 → up to 0.6). This is how the Urivo Score evolves from "estimated" to
  // "proven" as the install base grows — the part competitors can't copy.
  let finalScore = score100;
  if (learned && learned.sampleSize > 0) {
    const perf = learnedPerformance(learned);
    const learnedWeight = clamp01(learned.sampleSize / 200) * 0.6;
    finalScore = Math.round(score100 * (1 - learnedWeight) + perf.value * 100 * learnedWeight);
    reasons.unshift(...perf.reasons); // proven results lead
    confidence = Number(Math.min(1, confidence + learnedWeight).toFixed(2));
  }

  const stars = Math.max(1, Math.min(5, Math.round(finalScore / 20)));
  return { score: finalScore, stars, confidence, reasons, breakdown: parts };
}

/** Measured platform performance → 0–1 value + human reasons. Missing sub-signals
 *  are neutral (0.5), same discipline as the public score. */
function learnedPerformance(l: LearnedSignals): { value: number; reasons: string[] } {
  const W = { conversion: 0.3, repeat: 0.2, aov: 0.15, removal: 0.2, niche: 0.15 };
  const reasons: string[] = [];

  const convPresent = l.conversionIndex != null;
  const conv = convPresent ? clamp01(l.conversionIndex! / 2) : 0.5;
  if (convPresent && l.conversionIndex! >= 1.2) reasons.push(`Converts ${l.conversionIndex!.toFixed(1)}× the platform average`);

  const repeatPresent = l.repeatPurchaseRatePct != null;
  const repeat = repeatPresent ? clamp01(l.repeatPurchaseRatePct! / 40) : 0.5;
  if (repeatPresent && l.repeatPurchaseRatePct! >= 25) reasons.push(`High repeat purchase (${Math.round(l.repeatPurchaseRatePct!)}%)`);

  const aovPresent = l.aovIndex != null;
  const aov = aovPresent ? clamp01(l.aovIndex! / 2) : 0.5;
  if (aovPresent && l.aovIndex! >= 1.2) reasons.push("Lifts average order value");

  const remPresent = l.removalRatePct != null;
  const removal = remPresent ? clamp01((30 - l.removalRatePct!) / 30) : 0.5;
  if (remPresent && l.removalRatePct! <= 5) reasons.push(`Kept by ${Math.round(100 - l.removalRatePct!)}% of merchants`);

  const nichePresent = l.nicheFitScore != null;
  const niche = nichePresent ? clamp01(l.nicheFitScore!) : 0.5;

  const value =
    conv * W.conversion + repeat * W.repeat + aov * W.aov + removal * W.removal + niche * W.niche;
  return { value, reasons };
}

/** Score + rank a batch, best opportunity first. */
export function rankByUrivoScore(
  products: SupplierProduct[],
  targetRetailFor?: (p: SupplierProduct) => Money | null | undefined,
): { product: SupplierProduct; score: UrivoScore }[] {
  return products
    .map((product) => ({ product, score: scoreSupplierProduct(product, targetRetailFor?.(product)) }))
    .sort((a, b) => b.score.score - a.score.score);
}
