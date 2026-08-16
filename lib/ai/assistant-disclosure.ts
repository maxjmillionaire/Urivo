/*
 * Assistant disclosure (EU AI Act, Article 50(1) — applies from 2 August 2026).
 *
 * Article 50(1) is the one obligation that lands on Urivo's OWN product rather
 * than on the stores it generates: an AI system intended to interact directly
 * with a person must inform that person they are interacting with an AI, and it
 * must do so at the first exchange. The Commission's July 2026 guidelines are
 * explicit that a product name is not a disclosure and that burying the fact in
 * terms and conditions does not discharge the duty — so "Ask Urivo" on its own,
 * however obvious it feels to us, is not the disclosure.
 *
 * The exemption for cases that are "obvious to a reasonably well-informed
 * person" is deliberately NOT relied on here. It is an argument, not a fact, and
 * the cost of losing it is 3% of worldwide turnover; the cost of stating the
 * obvious is one line of grey text.
 *
 * Two surfaces, because they answer two different failure modes:
 *
 *   LABEL — persistent, in the rail header. A founder who returns to an
 *   existing conversation never sees a first-exchange notice, and the duty is
 *   about the person, not the session.
 *
 *   NOTICE — the explicit sentence, shown before the first message is sent.
 *   This is the one that satisfies "informed at the first interaction".
 *
 * Pure and dependency-free so the wording is unit-testable and has exactly one
 * definition. Kept separate from lib/storefront/ai-disclosure.ts, which is the
 * unrelated shopper-facing imagery rule under Article 50(2).
 */

/** Persistent header label. Sits beside the product name, never replaces it. */
export const AI_ASSISTANT_LABEL = "AI assistant";

/** Shown before the first message. Names the AI plainly, in the first clause. */
export const AI_ASSISTANT_NOTICE = "You're talking with an AI assistant.";

/**
 * True when a string discloses AI to a reader who is not looking for it.
 *
 * Exported because it is the rule the guard test applies to the component, and
 * a guard that hardcodes today's sentence would pass forever while the UI drifts
 * out from under it. "Urivo" is deliberately not accepted: a brand name is not a
 * disclosure, which is the entire point of Article 50(1).
 */
export function disclosesAi(copy: string | null | undefined): boolean {
  const text = (copy ?? "").toLowerCase();
  return /\bai\b|\bki\b|artificial intelligence|künstliche intelligenz/.test(text);
}
