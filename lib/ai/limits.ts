/*
 * AI input budgets — the margin-protection layer (spec 6.2).
 *
 * Every credit-consuming AI action already caps its OUTPUT via `max_tokens`.
 * This module caps the INPUT — the one dimension a user can otherwise inflate
 * without limit by pasting long text or accumulating a long conversation. With
 * both ends bounded, the worst-case token cost of every action is a fixed
 * ceiling that cannot be exceeded, regardless of user behaviour.
 *
 * Why this matters: the credit system already caps how MANY actions a user can
 * run per month. These budgets cap how much a SINGLE action can cost. Together
 * they make the real cost-per-credit provably bounded — which is what keeps the
 * deep launch/creator prices profitable even when a user burns every credit on
 * the most expensive action. See the cost table below.
 *
 * Pure utility (no server-only imports) so it can be reused anywhere.
 *
 * ── Guaranteed worst-case cost per action (Opus 4.8: €0.005/1k in, €0.025/1k
 *    out; ~4 chars/token) ────────────────────────────────────────────────────
 *   Store generation (10 cr): ~€0.41  → ~€0.041/credit
 *   Market research   (3 cr): ~€0.11  → ~€0.037/credit
 *   Ad studio         (2 cr): ~€0.11  → ~€0.054/credit
 *   Store editor      (2 cr): ~€0.08  → ~€0.038/credit
 *   Ask Urivo         (1 cr): ~€0.04  → ~€0.039/credit
 * Every action stays at or under ~€0.054/credit — roughly half the €0.10
 * planning figure and far below the €0.10–0.18 break-even of even the deepest
 * creator price. The "worst case" is engineered out, not hoped away.
 *
 * If you raise any `max_tokens` or a budget here, re-check the row above: the
 * invariant is worst-case-cost(action) ≤ its credit budget × €0.10.
 */

export const AI_INPUT_BUDGET = {
  /** Ask Urivo (1 credit): a light conversational turn. */
  askMaxTurns: 12,
  askHistoryChars: 12_000,
  askPerMessageChars: 4_000,

  /** Store editor (2 credits): carries a store snapshot in context too. */
  editorMaxTurns: 12,
  editorHistoryChars: 14_000,

  /** Single-prompt surfaces (generation, research). Mirrors the route's cap. */
  promptChars: 600,
} as const;

/** Trim a string to a hard maximum length (defensive; never throws). */
export function clampText(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Keep the most recent turns that fit BOTH a turn-count and a total-character
 * budget, preserving chronological order. Trims oldest-first; always keeps at
 * least the latest turn. This is the hard ceiling on conversation input — the
 * route's per-message cap plus this bound the total the model ever receives.
 */
export function boundHistory<T extends { content: string }>(
  turns: readonly T[],
  maxTurns: number,
  maxTotalChars: number,
): T[] {
  const kept: T[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < maxTurns; i--) {
    const turn = turns[i];
    // Once we have at least the latest turn, stop before blowing the budget.
    if (kept.length > 0 && total + turn.content.length > maxTotalChars) break;
    kept.push(turn);
    total += turn.content.length;
  }
  return kept.reverse();
}
