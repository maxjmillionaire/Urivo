/*
 * Credit costs — the single source of truth for what every AI action costs.
 *
 * Costs reflect real compute + value. Store generation is the heavy action —
 * it runs the full brand + catalogue + FIVE product photos in one shot, so it
 * costs far more than a chat turn; editing/iteration stays cheap so refining a
 * store never feels punitive. This is what makes the allocations meaningful:
 * a Founder's monthly credits buy ~3–5 complete stores (a generation plus a
 * round of refinements each), while Pro buys many more. Funnel helpers that must
 * never dead-end (naming, availability checks) stay free, and the deterministic
 * Evolution Lab costs nothing because it makes no API call.
 *
 * Isomorphic (no server-only imports) so the UI can show costs before an action.
 */

export const CREDIT_COSTS = {
  /** Full store: brand + catalogue + 5 product photos in one shot. The hero action. */
  storeGeneration: 20,
  /** One Ask Urivo turn — a chat reply or a proposed store edit. Cheap by design. */
  askMessage: 1,
  /** A full market-research report. */
  marketResearch: 3,
  /** An ad plan (strategy + creatives). */
  adStudio: 3,
  /** Regenerating a single product image (Higgsfield — real per-image cost). */
  productImage: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export function creditCost(action: CreditAction): number {
  return CREDIT_COSTS[action];
}
