/*
 * Cost / margin simulator — answers "if we change price X or credits Y, what
 * happens to the money?" instantly and without guessing. Every number traces
 * back to lib/finance/cost-model (real provider prices + grounded profiles).
 *
 * Two economics per tier are always produced side by side:
 *   - realistic: expected usage (a credit mix at typical cost × utilisation).
 *   - worstCase: every credit burned on the most expensive action at its hard
 *     token/image ceiling. This is a real floor, not a fear — the input/output
 *     limits in lib/ai guarantee it can't be exceeded.
 *
 * Isomorphic — the admin/pricing UI imports this directly.
 */

import {
  ACTION_PROFILES,
  costPerCredit,
  estimateActionCost,
  type AiFeature,
  type ModelId,
  ACTIVE_MODEL,
} from "./cost-model";

// ── Assumptions (all overridable, none hidden) ───────────────────────────────

/** Share of a user's monthly credits spent on each feature. Replace with the
 *  measured mix from the ledger once real data exists. Must sum to 1. */
export const DEFAULT_USAGE_MIX: Record<AiFeature, number> = {
  storeGeneration: 0.4,
  askMessage: 0.35,
  storeEdit: 0.05,
  marketResearch: 0.1,
  adStudio: 0.05,
  productImage: 0.05,
};

/** Fraction of granted monthly credits an average paying user actually burns. */
export const DEFAULT_UTILIZATION = 0.5;

export interface TierInput {
  /** Monthly EUR price the customer pays. */
  priceEur: number;
  /** Credits granted per month. */
  monthlyCredits: number;
  /** Expected credit utilisation (0–1). Default 0.5. */
  utilization?: number;
  /** Credit spend mix. Default DEFAULT_USAGE_MIX. */
  usageMix?: Record<AiFeature, number>;
  /** Investor revenue share, fraction of gross (e.g. 0.05). Default 0.05. */
  investorShare?: number;
  /** Stripe fee: percentage of charge + fixed EUR. Default 2.5% + €0.25. */
  stripePct?: number;
  stripeFixedEur?: number;
  /** Fixed infra amortised per user per month (EUR). Default 0. */
  fixedPerUserEur?: number;
  model?: ModelId;
}

export interface TierEconomics {
  priceEur: number;
  monthlyCredits: number;
  // Fixed deductions (independent of AI usage)
  stripeEur: number;
  investorEur: number;
  fixedEur: number;
  // AI + image variable cost
  aiCostRealisticEur: number;
  aiCostWorstEur: number;
  blendedCostPerCreditEur: number;
  worstCostPerCreditEur: number;
  // Results
  contributionRealisticEur: number; // price − stripe − investor − ai (excl. fixed)
  profitRealisticEur: number; // contribution − fixed
  profitWorstEur: number;
  marginRealisticPct: number; // net margin incl. fixed
  marginWorstPct: number;
}

/** Blended realistic €/credit from a usage mix at typical cost. */
export function blendedCostPerCredit(
  usageMix: Record<AiFeature, number> = DEFAULT_USAGE_MIX,
  model: ModelId = ACTIVE_MODEL,
): number {
  return (Object.keys(usageMix) as AiFeature[]).reduce(
    (sum, f) => sum + usageMix[f] * costPerCredit(f, "typical", model),
    0,
  );
}

/** The single most expensive €/credit at the hard ceiling — the worst case. */
export function worstCostPerCredit(model: ModelId = ACTIVE_MODEL): number {
  return (Object.keys(ACTION_PROFILES) as AiFeature[]).reduce(
    (max, f) => Math.max(max, costPerCredit(f, "max", model)),
    0,
  );
}

/** Full economics for one tier. The core of the simulator. */
export function simulateTier(input: TierInput): TierEconomics {
  const {
    priceEur,
    monthlyCredits,
    utilization = DEFAULT_UTILIZATION,
    usageMix = DEFAULT_USAGE_MIX,
    investorShare = 0.05,
    stripePct = 0.025,
    stripeFixedEur = 0.25,
    fixedPerUserEur = 0,
    model = ACTIVE_MODEL,
  } = input;

  const stripeEur = priceEur > 0 ? priceEur * stripePct + stripeFixedEur : 0;
  const investorEur = priceEur * investorShare;

  const blendedCpc = blendedCostPerCredit(usageMix, model);
  const worstCpc = worstCostPerCredit(model);

  const aiCostRealisticEur = monthlyCredits * utilization * blendedCpc;
  const aiCostWorstEur = monthlyCredits * worstCpc; // 100% burn on the worst action

  const contributionRealisticEur = priceEur - stripeEur - investorEur - aiCostRealisticEur;
  const profitRealisticEur = contributionRealisticEur - fixedPerUserEur;
  const profitWorstEur = priceEur - stripeEur - investorEur - aiCostWorstEur - fixedPerUserEur;

  const marginRealisticPct = priceEur > 0 ? (profitRealisticEur / priceEur) * 100 : 0;
  const marginWorstPct = priceEur > 0 ? (profitWorstEur / priceEur) * 100 : 0;

  return {
    priceEur,
    monthlyCredits,
    stripeEur,
    investorEur,
    fixedEur: fixedPerUserEur,
    aiCostRealisticEur,
    aiCostWorstEur,
    blendedCostPerCreditEur: blendedCpc,
    worstCostPerCreditEur: worstCpc,
    contributionRealisticEur,
    profitRealisticEur,
    profitWorstEur,
    marginRealisticPct,
    marginWorstPct,
  };
}

// ── Revenue-per-credit (question 5) ──────────────────────────────────────────

export interface FeatureEfficiency {
  feature: AiFeature;
  credits: number;
  /** EUR revenue attributable to one credit at this tier (price ÷ credits). */
  revenuePerCreditEur: number;
  /** EUR cost of one credit spent on this feature (typical). */
  costPerCreditEur: number;
  /** Gross margin on a credit spent here (1 − cost/revenue). */
  marginPct: number;
  /** EUR margin left after one credit is spent on this feature. */
  marginPerCreditEur: number;
}

/**
 * How efficient each feature is financially: revenue a credit represents vs what
 * it costs us when spent on that feature. Reveals which features are money-makers
 * and which quietly erode margin (answer to question 5).
 */
export function featureEfficiency(
  priceEur: number,
  monthlyCredits: number,
  model: ModelId = ACTIVE_MODEL,
): FeatureEfficiency[] {
  const revenuePerCredit = monthlyCredits > 0 ? priceEur / monthlyCredits : 0;
  return (Object.keys(ACTION_PROFILES) as AiFeature[]).map((feature) => {
    const cpc = costPerCredit(feature, "typical", model);
    const marginPerCreditEur = revenuePerCredit - cpc;
    const marginPct = revenuePerCredit > 0 ? (marginPerCreditEur / revenuePerCredit) * 100 : 0;
    return {
      feature,
      credits: ACTION_PROFILES[feature].credits,
      revenuePerCreditEur: revenuePerCredit,
      costPerCreditEur: cpc,
      marginPct,
      marginPerCreditEur,
    };
  });
}

/** Convenience: full unit cost of a single action at a scenario, for display. */
export function actionUnitCostEur(
  feature: AiFeature,
  scenario: "typical" | "max" = "typical",
  model: ModelId = ACTIVE_MODEL,
): number {
  return estimateActionCost(feature, scenario, model).totalEur;
}
