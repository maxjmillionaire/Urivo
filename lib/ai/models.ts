/*
 * Model routing — the single source of truth for which model each AI action
 * uses. Previously every AI module hardcoded the model as its own constant, so
 * a routing change meant touching eight files; now they all resolve here.
 *
 * Everything runs on the flagship model today, deliberately: one-shot quality
 * is the product (CLAUDE.md — "default to the most capable models", "optimize
 * for longevity, not speed"). Each action is env-overridable so a cheaper or
 * faster model can be A/B-tested per action — without a deploy and without
 * hunting through route handlers — the day volume makes margin worth tuning.
 * Never flip an action blind: measure quality on real traffic first, and the
 * resolved model is recorded on every ai_usage_ledger row so cost stays exact.
 *
 *   e.g. URIVO_MODEL_ASSISTANT=claude-sonnet-5   (override one action)
 *        URIVO_MODEL_DEFAULT=claude-opus-4-7      (override the fallback)
 */

export const DEFAULT_MODEL = "claude-opus-4-8";

export type AiAction =
  | "storeGeneration"
  | "storeEdit"
  | "assistant"
  | "marketResearch"
  | "adStudio"
  | "naming"
  | "productOptimizer";

const ENV_KEY: Record<AiAction, string> = {
  storeGeneration: "URIVO_MODEL_STORE_GENERATION",
  storeEdit: "URIVO_MODEL_STORE_EDIT",
  assistant: "URIVO_MODEL_ASSISTANT",
  marketResearch: "URIVO_MODEL_MARKET_RESEARCH",
  adStudio: "URIVO_MODEL_AD_STUDIO",
  naming: "URIVO_MODEL_NAMING",
  productOptimizer: "URIVO_MODEL_PRODUCT_OPTIMIZER",
};

/** Resolve the model for an action: per-action override → global override → default. */
export function modelFor(action: AiAction): string {
  const override = process.env[ENV_KEY[action]] ?? process.env.URIVO_MODEL_DEFAULT;
  return override?.trim() || DEFAULT_MODEL;
}
