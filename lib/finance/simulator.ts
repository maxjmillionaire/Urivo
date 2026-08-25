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
  storeGeneration: 0.37,
  askMessage: 0.35,
  storeEdit: 0.05,
  marketResearch: 0.1,
  adStudio: 0.05,
  campaignDraft: 0.03,
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
  /** Investor revenue share, fraction of gross. Default 0.03 — the agreed 3%. */
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
  // Month-2 contribution margin (excl. fixed AND the one-time creator commission)
  // and its status against the 70% internal floor. Reporting only.
  contributionMarginRealisticPct: number;
  month2Floor: Month2FloorStatus;
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

/*
 * Month-2 contribution-margin floor — an internal economic guardrail, not a
 * customer-facing restriction. The business rule is that the recurring
 * (Month-2+) contribution margin must stay at or above 70%. "Contribution" here
 * is price − Stripe − investor − AI (the simulator's contributionRealisticEur),
 * which already excludes fixed cost AND the one-time creator commission — so it
 * is exactly the steady-state Month-2 economics. This only reports; it never
 * blocks billing, generation, or any product behaviour.
 */
export const MONTH2_MARGIN_FLOOR_PCT = 70;

export interface Month2FloorStatus {
  /** The modelled Month-2 contribution margin, %. */
  marginPct: number;
  /** The floor it is measured against (70). */
  floorPct: number;
  /** Percentage points of headroom above the floor; negative when breached. */
  headroomPp: number;
  /** True when the margin is below the 70% floor. */
  belowFloor: boolean;
  /** Human-readable status; the flag string when breached. */
  label: string;
}

/** Assess a Month-2 contribution margin (%) against the 70% floor. Pure. */
export function assessMonth2MarginFloor(
  contributionMarginPct: number,
  floorPct: number = MONTH2_MARGIN_FLOOR_PCT,
): Month2FloorStatus {
  const headroomPp = contributionMarginPct - floorPct;
  const belowFloor = headroomPp < 0;
  return {
    marginPct: contributionMarginPct,
    floorPct,
    headroomPp,
    belowFloor,
    label: belowFloor ? "BELOW M2 MARGIN FLOOR" : "OK",
  };
}

/** Full economics for one tier. The core of the simulator. */
export function simulateTier(input: TierInput): TierEconomics {
  const {
    priceEur,
    monthlyCredits,
    utilization = DEFAULT_UTILIZATION,
    usageMix = DEFAULT_USAGE_MIX,
    investorShare = 0.03,
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

  // Month-2 contribution margin: the recurring economics the 70% floor guards.
  const contributionMarginRealisticPct =
    priceEur > 0 ? (contributionRealisticEur / priceEur) * 100 : 0;
  const month2Floor = assessMonth2MarginFloor(contributionMarginRealisticPct);

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
    contributionMarginRealisticPct,
    month2Floor,
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
