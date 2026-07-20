/*
 * Credit costs — the single source of truth for what every AI action costs.
 *
 * The model (Lovable-style): the recurring credit sink is ITERATION — every
 * Ask Urivo message costs a credit — not the occasional store generation. Costs
 * scale with real compute + value. Funnel helpers that must never dead-end
 * (naming, availability checks) stay free, and the deterministic Evolution Lab
 * costs nothing because it makes no API call.
 *
 * Isomorphic (no server-only imports) so the UI can show costs before an action.
 */

export const CREDIT_COSTS = {
  /** Full store: brand + catalogue + product imagery. The hero action. */
  storeGeneration: 10,
  /** One Ask Urivo turn — a chat reply or a proposed store edit. The core sink. */
  askMessage: 1,
  /** A full market-research report. */
  marketResearch: 3,
  /** An ad plan (strategy + creatives). */
  adStudio: 2,
  /** Regenerating a single product image (Higgsfield). */
  productImage: 1,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export function creditCost(action: CreditAction): number {
  return CREDIT_COSTS[action];
}
