/*
 * Credit costs — the single source of truth for what every AI action costs.
 *
 * ── Pricing shape: cheap to arrive, priced to keep using ────────────────────
 *
 * Store generation is the ACQUISITION action and is deliberately held at 20.
 * The Free plan grants exactly 20 signup credits, so a new user can always
 * generate exactly one complete store without paying — that first store is the
 * whole top of the funnel, and it must never be one credit out of reach. It is
 * also the highest-margin action we run, so there is no cost reason to raise it.
 *
 * The RECURRING actions carry the margin. They are priced against measured
 * worst-case compute (see the table in lib/ai/limits.ts) so each lands in the
 * same band rather than one action quietly subsidising the rest:
 *
 *   action            credits   worst-case cost   revenue @ Founder   multiple
 *   store generation     20          €0.61              €6.54            11x
 *   Ask Urivo             2          €0.09              €0.65             7x
 *   market research       4          €0.11              €1.31            12x
 *   ad studio             4          €0.11              €1.31            12x
 *   product image         3        real Higgsfield      €0.98             —
 *
 * (Founder is €49 for 150 credits = €0.327/credit. A credit bought in a pack is
 * €0.66–0.95, so usage that outruns the plan is the most profitable usage there
 * is — which is the point of pricing the recurring actions honestly.)
 *
 * Ask Urivo moved 1 → 2 because it genuinely changed: it now streams with
 * adaptive thinking, a 2,400-token ceiling and a full business snapshot in
 * context. At 1 credit it was the thinnest-margin action we sold by a factor of
 * three, and it was the one users lean on hardest.
 *
 * Funnel helpers that must never dead-end (naming, availability checks) stay
 * free, and the deterministic Evolution Lab costs nothing because it makes no
 * API call.
 *
 * Isomorphic (no server-only imports) so the UI can show costs before an action.
 */

export const CREDIT_COSTS = {
  /**
   * Full store: brand + catalogue + 5 product photos in one shot. The hero
   * action, and the one a free signup must be able to afford exactly once —
   * keep this equal to PLANS.free.signupCredits.
   */
  storeGeneration: 20,
  /** One Ask Urivo turn — streaming, business-aware, and able to propose an edit. */
  askMessage: 2,
  /** A full market-research report. */
  marketResearch: 4,
  /** An ad plan (strategy + creatives). */
  adStudio: 4,
  /** Regenerating a single product image (Higgsfield — real per-image cost). */
  productImage: 3,
  /** Drafting a campaign to the store's subscriber list — one structured call,
   *  priced like an Ask turn. Sending the campaign itself is free (no model). */
  campaignDraft: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export function creditCost(action: CreditAction): number {
  return CREDIT_COSTS[action];
}
