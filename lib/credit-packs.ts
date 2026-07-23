/*
 * One-time credit packs — the overflow valve for someone who runs out mid-flow
 * and doesn't want to commit to a subscription yet.
 *
 * Pricing psychology, applied honestly (no dark patterns, no fake urgency):
 *  - Charm pricing / left-digit effect: €19 / €49 / €99.
 *  - Good-better-best with a center-stage default (Studio = "Most popular").
 *  - Real volume discount: credits grow faster than price at every step, so the
 *    per-credit rate genuinely falls (Boost €0.95 → Studio €0.82 → Scale €0.66).
 *  - Honest anchoring: savings are computed against the Boost base rate, never invented.
 *  - Deliberate contrast that favours the subscription: Scale is 150 credits for
 *    €99 once, sitting next to Founder's 150 credits for €49 EVERY month — so the
 *    smart buyer is nudged toward subscribing, truthfully.
 *
 * Every pack's per-credit price stays ABOVE the subscription's, so packs can
 * never cannibalise Founder/Pro.
 */

/** Mirror of lib/credits STORE_GENERATION_COST — kept here so this module stays
 *  isomorphic (client-importable) rather than pulling in server-only credit code. */
const STORE_GENERATION_COST = 20;

export type CreditPackId = "boost" | "studio" | "scale";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  credits: number;
  priceEUR: number;
  /** True marketing badge, or null. */
  badge: string | null;
}

export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  boost: { id: "boost", name: "Boost", credits: 20, priceEUR: 19, badge: null },
  studio: { id: "studio", name: "Studio", credits: 60, priceEUR: 49, badge: "Most popular" },
  scale: { id: "scale", name: "Scale", credits: 150, priceEUR: 99, badge: "Best value" },
};

export const CREDIT_PACK_ORDER: CreditPackId[] = ["boost", "studio", "scale"];

export function getCreditPack(id: string): CreditPack | null {
  return id === "boost" || id === "studio" || id === "scale" ? CREDIT_PACKS[id] : null;
}

/** How many stores a pack's credits generate (for tangible unit framing). */
export function packStores(pack: CreditPack): number {
  return Math.floor(pack.credits / STORE_GENERATION_COST);
}

/** Per-credit price in euros (e.g. 0.82). */
export function perCredit(pack: CreditPack): number {
  return pack.priceEUR / pack.credits;
}

/**
 * Honest savings vs the entry (Boost) per-credit rate, as a rounded percentage.
 * Boost itself returns 0. Used for the "–14% / –30%" badges.
 */
export function savingsPct(pack: CreditPack): number {
  const base = perCredit(CREDIT_PACKS.boost);
  const pct = Math.round((1 - perCredit(pack) / base) * 100);
  return pct > 0 ? pct : 0;
}
