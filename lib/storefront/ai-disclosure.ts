/*
 * AI imagery disclosure (EU AI Act, Article 50 — applies from 2 August 2026).
 *
 * Urivo generates product photography, so its stores publish AI-generated
 * content and the merchant is the one publishing it. This decides WHETHER a
 * store must disclose, and in WHAT WORDS.
 *
 * Two design rules, both of which exist to protect conversion rather than to
 * satisfy a checklist:
 *
 * 1. DISCLOSE ONLY WHAT IS TRUE. A merchant who replaced our imagery with
 *    their own photographs must not be made to declare real work synthetic —
 *    that is a false statement in the other direction, and it would cost them
 *    exactly the trust the label is supposed to protect. Provenance is per
 *    image (migration 0032); a store with no AI photos says nothing.
 *
 * 2. INFORM, DO NOT WARN. A hazard badge stamped on a product shot reads as a
 *    defect and costs the sale. A quiet, well-set line near the imagery reads
 *    as a brand that is straight with you — which is worth more than the
 *    fraction of a percent it might cost. The wording is descriptive
 *    ("Product imagery created with AI"), never apologetic and never a
 *    disclaimer.
 *
 * Pure — no server-only import — so the rule is unit-testable on its own.
 */

/** Provenance values that oblige a disclosure. NULL is included on purpose. */
const DISCLOSABLE = new Set(["ai", "placeholder"]);

export interface ImageProvenance {
  image_url?: string | null;
  image_source?: string | null;
}

/**
 * Must this catalogue disclose AI imagery?
 *
 * Unknown provenance (null) counts as disclosable. An image Urivo cannot vouch
 * for is one it must not quietly present as a photograph — and every image the
 * platform produced before provenance existed is unknown.
 */
export function needsAiDisclosure(products: readonly ImageProvenance[]): boolean {
  return products.some(
    (p) => Boolean(p.image_url) && (p.image_source == null || DISCLOSABLE.has(p.image_source)),
  );
}

/**
 * The disclosure line. Short enough to sit under a product grid without
 * competing with it, specific enough to be a real disclosure.
 */
export const AI_DISCLOSURE = "Product imagery created with AI.";

/** German stores get it in German — a disclosure nobody reads is not one. */
export const AI_DISCLOSURE_DE = "Produktbilder mit KI erstellt.";

/**
 * Pick the wording for a storefront. Language is inferred from the store's own
 * copy rather than the visitor's browser: the disclosure belongs to the page,
 * and a German shop should not disclose in English to a German shopper.
 */
export function aiDisclosureFor(sampleCopy: string | null | undefined): string {
  const text = (sampleCopy ?? "").toLowerCase();
  // Deliberately crude, and only ever chooses between two safe strings.
  const german = /\b(und|der|die|das|für|mit|ist|nicht|wir|unsere|ihre)\b/.test(text);
  return german ? AI_DISCLOSURE_DE : AI_DISCLOSURE;
}
