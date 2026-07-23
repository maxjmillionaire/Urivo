/*
 * Urivo cost model — the single source of truth for what money an AI action
 * really costs us. No estimates live anywhere else; every margin number, the
 * simulator and the ledger all read from here.
 *
 * Isomorphic (no server-only imports) so the billing/admin UI and the simulator
 * can use it directly.
 *
 * Two ways to price an action:
 *   1. costOfActionExact()  — from REAL usage (tokens + images) captured off the
 *      provider response. This is what the ledger writes. Zero guessing.
 *   2. estimateActionCost() — from the token PROFILES below, for planning before
 *      real data exists (the simulator's default). Every profile is grounded in
 *      the actual max_tokens caps and input budgets enforced in lib/ai.
 *
 * When real ledger data exists, prefer it. The profiles are the fallback, and
 * they are deliberately conservative (typical is realistic, max is the hard
 * ceiling the input/output limits guarantee).
 */

// ── Provider pricing (USD per token) ─────────────────────────────────────────
// Source: Anthropic list price. Opus 4.8 = $5.00 / 1M input, $25.00 / 1M output.
// Keep this table so a model swap is a one-line change and the simulator can
// compare "what if we move Ask Urivo to a cheaper model" (see MODELS).
export interface ModelPrice {
  id: string;
  inputPerToken: number; // USD
  outputPerToken: number; // USD
}

export const MODELS = {
  "claude-opus-4-8": { id: "claude-opus-4-8", inputPerToken: 5.0 / 1e6, outputPerToken: 25.0 / 1e6 },
  "claude-sonnet-5": { id: "claude-sonnet-5", inputPerToken: 3.0 / 1e6, outputPerToken: 15.0 / 1e6 },
  "claude-haiku-4-5": { id: "claude-haiku-4-5", inputPerToken: 1.0 / 1e6, outputPerToken: 5.0 / 1e6 },
} as const satisfies Record<string, ModelPrice>;

export type ModelId = keyof typeof MODELS;

/** The model every AI action currently runs on. Change here to change reality. */
export const ACTIVE_MODEL: ModelId = "claude-opus-4-8";

// ── Image pricing (USD per generated image) ──────────────────────────────────
// ⚠️ ESTIMATE — Higgsfield's exact per-image rate is not yet confirmed in code.
// This is the ONE cost input still to be replaced with a measured value. When
// the image route logs real spend, this becomes a fallback only.
export const IMAGE_COST_USD = 0.07;

// ── FX ───────────────────────────────────────────────────────────────────────
// Costs are provider-side USD; revenue is EUR. One knob, stated openly, so no
// margin number silently assumes 1:1. Update from the real rate periodically.
export const USD_PER_EUR = 1.08; // 1 EUR ≈ 1.08 USD
export const EUR_PER_USD = 1 / USD_PER_EUR;

export function usdToEur(usd: number): number {
  return usd * EUR_PER_USD;
}

// ── Actions ──────────────────────────────────────────────────────────────────
export type AiFeature =
  | "storeGeneration"
  | "askMessage"
  | "storeEdit"
  | "marketResearch"
  | "adStudio"
  | "productImage";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/*
 * Per-action token/image profiles. Grounded in the real config:
 *   - outMax === the max_tokens cap enforced in the corresponding lib/ai module.
 *   - inMax === system prompt + the input budget cap from lib/ai/limits.ts.
 *   - typical === a realistic middle, to be replaced by measured medians.
 * credits === the price in CREDIT_COSTS (kept in sync; asserted in tests).
 */
export interface ActionProfile {
  credits: number;
  inTypical: number;
  outTypical: number;
  inMax: number;
  outMax: number;
  imagesTypical: number;
  imagesMax: number;
}

export const ACTION_PROFILES: Record<AiFeature, ActionProfile> = {
  // System ~1900t + prompt ≤600 chars. Output cap 16000 (incl. thinking). 3–8 images.
  storeGeneration: { credits: 20, inTypical: 2000, outTypical: 7000, inMax: 2100, outMax: 16000, imagesTypical: 5, imagesMax: 8 },
  // System ~600t + context ~700t + history ≤12000 chars (~3000t). Output cap 700.
  askMessage: { credits: 1, inTypical: 1500, outTypical: 350, inMax: 4300, outMax: 700, imagesTypical: 0, imagesMax: 0 },
  // System ~1000t + context ~800t + history ≤14000 chars (~3500t). Output cap 2000.
  storeEdit: { credits: 1, inTypical: 2000, outTypical: 600, inMax: 5300, outMax: 2000, imagesTypical: 0, imagesMax: 0 },
  // System ~750t + prompt ≤600 chars. Output cap 4000.
  marketResearch: { credits: 3, inTypical: 900, outTypical: 2500, inMax: 900, outMax: 4000, imagesTypical: 0, imagesMax: 0 },
  // System ~750t + store context ~800t. Output cap 4000.
  adStudio: { credits: 3, inTypical: 1550, outTypical: 2800, inMax: 1550, outMax: 4000, imagesTypical: 0, imagesMax: 0 },
  // Pure image action (no LLM tokens).
  productImage: { credits: 2, inTypical: 0, outTypical: 0, inMax: 0, outMax: 0, imagesTypical: 1, imagesMax: 1 },
};

// ── Cost functions ───────────────────────────────────────────────────────────

/** USD cost of a given token count on a given model. */
export function anthropicCostUsd(usage: TokenUsage, model: ModelId = ACTIVE_MODEL): number {
  const m = MODELS[model];
  return usage.inputTokens * m.inputPerToken + usage.outputTokens * m.outputPerToken;
}

export interface ActionCost {
  anthropicUsd: number;
  imageUsd: number;
  totalUsd: number;
  totalEur: number;
}

/**
 * EXACT cost of one action from real measured usage. This is what the ledger
 * writes — the answer to "what did this specific call cost us?".
 */
export function costOfActionExact(
  usage: TokenUsage,
  images: number,
  model: ModelId = ACTIVE_MODEL,
): ActionCost {
  const anthropicUsd = anthropicCostUsd(usage, model);
  const imageUsd = images * IMAGE_COST_USD;
  const totalUsd = anthropicUsd + imageUsd;
  return { anthropicUsd, imageUsd, totalUsd, totalEur: usdToEur(totalUsd) };
}

export type CostScenario = "typical" | "max";

/** Planning cost of an action from its profile, when no real data exists yet. */
export function estimateActionCost(
  feature: AiFeature,
  scenario: CostScenario = "typical",
  model: ModelId = ACTIVE_MODEL,
): ActionCost {
  const p = ACTION_PROFILES[feature];
  const usage: TokenUsage =
    scenario === "max"
      ? { inputTokens: p.inMax, outputTokens: p.outMax }
      : { inputTokens: p.inTypical, outputTokens: p.outTypical };
  const images = scenario === "max" ? p.imagesMax : p.imagesTypical;
  return costOfActionExact(usage, images, model);
}

/** Cost per single credit for an action (its cost ÷ its credit price). */
export function costPerCredit(
  feature: AiFeature,
  scenario: CostScenario = "typical",
  model: ModelId = ACTIVE_MODEL,
): number {
  const p = ACTION_PROFILES[feature];
  return estimateActionCost(feature, scenario, model).totalEur / p.credits;
}
