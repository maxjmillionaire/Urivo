/*
 * SaaS KPI engine — the metrics a VC will ask for, computed from explicit
 * inputs (no hidden assumptions). These are pure formulas; the data behind them
 * comes from Stripe (revenue, churn), the credit ledger (credits) and the AI
 * usage ledger (real cost). Wire those sources in and every number below is live.
 *
 * Definitions follow standard SaaS convention (SaaS Capital / a16z / Bessemer):
 *   - MRR is normalised monthly recurring revenue.
 *   - Retention metrics compare a cohort's start-of-period MRR to its end.
 *   - Margins are gross (revenue − variable COGS) unless named "net".
 *
 * Isomorphic.
 */

// ── Revenue ──────────────────────────────────────────────────────────────────

export interface PlanSubscribers {
  planKey: string;
  subscribers: number;
  monthlyPriceEur: number;
}

/** Monthly Recurring Revenue from a subscriber breakdown. */
export function mrr(plans: PlanSubscribers[]): number {
  return plans.reduce((sum, p) => sum + p.subscribers * p.monthlyPriceEur, 0);
}

/** Annual Recurring Revenue. */
export function arr(monthlyRecurringRevenue: number): number {
  return monthlyRecurringRevenue * 12;
}

/** Average Revenue Per User — across ALL active users incl. free. */
export function arpu(monthlyRecurringRevenue: number, activeUsers: number): number {
  return activeUsers > 0 ? monthlyRecurringRevenue / activeUsers : 0;
}

/** Average Revenue Per PAYING User. */
export function arppu(monthlyRecurringRevenue: number, payingUsers: number): number {
  return payingUsers > 0 ? monthlyRecurringRevenue / payingUsers : 0;
}

// ── Margins ──────────────────────────────────────────────────────────────────

export interface MarginInput {
  revenue: number;
  /** Variable cost of goods: AI + images + payment fees + variable infra. */
  variableCogs: number;
  /** Fixed operating cost for the period (infra, salaries if included). */
  fixedCost?: number;
}

/** Gross margin % = (revenue − variable COGS) / revenue. */
export function grossMarginPct({ revenue, variableCogs }: MarginInput): number {
  return revenue > 0 ? ((revenue - variableCogs) / revenue) * 100 : 0;
}

/** Contribution margin (absolute) = revenue − variable COGS. */
export function contributionMargin({ revenue, variableCogs }: MarginInput): number {
  return revenue - variableCogs;
}

/** Net margin % = (revenue − variable COGS − fixed) / revenue. */
export function netMarginPct({ revenue, variableCogs, fixedCost = 0 }: MarginInput): number {
  return revenue > 0 ? ((revenue - variableCogs - fixedCost) / revenue) * 100 : 0;
}

// ── Unit economics ───────────────────────────────────────────────────────────

/** Customer Acquisition Cost = sales+marketing spend ÷ new customers won. */
export function cac(salesMarketingSpend: number, newCustomers: number): number {
  return newCustomers > 0 ? salesMarketingSpend / newCustomers : 0;
}

export interface LtvInput {
  /** Avg monthly gross profit per paying customer (ARPPU × gross margin). */
  monthlyGrossProfitPerCustomer: number;
  /** Monthly revenue churn rate (0–1). LTV = profit / churn. */
  monthlyRevenueChurn: number;
}

/**
 * Lifetime Value (gross-profit based — the honest version VCs expect, not the
 * revenue-based vanity one). LTV = monthly gross profit / monthly churn.
 */
export function ltv({ monthlyGrossProfitPerCustomer, monthlyRevenueChurn }: LtvInput): number {
  return monthlyRevenueChurn > 0 ? monthlyGrossProfitPerCustomer / monthlyRevenueChurn : Infinity;
}

/** LTV : CAC ratio — VCs want ≥ 3. */
export function ltvCac(lifetimeValue: number, acquisitionCost: number): number {
  return acquisitionCost > 0 ? lifetimeValue / acquisitionCost : Infinity;
}

/** CAC payback in months = CAC ÷ monthly gross profit per customer. */
export function paybackMonths(acquisitionCost: number, monthlyGrossProfitPerCustomer: number): number {
  return monthlyGrossProfitPerCustomer > 0 ? acquisitionCost / monthlyGrossProfitPerCustomer : Infinity;
}

// ── Cash ─────────────────────────────────────────────────────────────────────

/** Net monthly burn = cash out − cash in (positive = burning). */
export function burnRate(monthlyCashOut: number, monthlyCashIn: number): number {
  return monthlyCashOut - monthlyCashIn;
}

/** Runway in months = cash on hand ÷ monthly burn (Infinity if cash-flow positive). */
export function runwayMonths(cashOnHand: number, monthlyBurn: number): number {
  return monthlyBurn > 0 ? cashOnHand / monthlyBurn : Infinity;
}

// ── Retention (cohort period-over-period) ────────────────────────────────────

export interface RetentionInput {
  /** MRR from the cohort at the START of the period. */
  startMrr: number;
  /** MRR gained from existing customers upgrading / buying more. */
  expansionMrr: number;
  /** MRR lost to downgrades (still-active customers paying less). */
  contractionMrr: number;
  /** MRR lost to customers who fully cancelled. */
  churnedMrr: number;
}

/** Net Revenue Retention % — the single number a16z/Sequoia stare at. >100% = growth without new logos. */
export function nrr({ startMrr, expansionMrr, contractionMrr, churnedMrr }: RetentionInput): number {
  return startMrr > 0
    ? ((startMrr + expansionMrr - contractionMrr - churnedMrr) / startMrr) * 100
    : 0;
}

/** Gross Revenue Retention % — retention with expansion excluded (never > 100%). */
export function grr({ startMrr, contractionMrr, churnedMrr }: RetentionInput): number {
  return startMrr > 0 ? ((startMrr - contractionMrr - churnedMrr) / startMrr) * 100 : 0;
}

/** Logo (customer-count) churn % over a period. */
export function logoChurnPct(customersLost: number, customersAtStart: number): number {
  return customersAtStart > 0 ? (customersLost / customersAtStart) * 100 : 0;
}

/** Revenue churn % = churned MRR ÷ start MRR (gross; before expansion). */
export function revenueChurnPct(churnedMrr: number, startMrr: number): number {
  return startMrr > 0 ? (churnedMrr / startMrr) * 100 : 0;
}

// ── Ledger-derived per-user cost (needs the AI usage ledger) ─────────────────

export interface UserCostRollup {
  users: number;
  totalAiCostEur: number;
  totalImageCostEur: number;
  totalCreditsBurned: number;
  totalCreditsPurchased: number;
}

export interface PerUserCost {
  avgAiCostEur: number;
  avgImageCostEur: number;
  avgCreditsBurned: number;
  avgCreditsPurchased: number;
}

/** Average AI/image cost and credits per user — straight from the ledger. */
export function perUserCost(r: UserCostRollup): PerUserCost {
  const n = r.users || 1;
  return {
    avgAiCostEur: r.totalAiCostEur / n,
    avgImageCostEur: r.totalImageCostEur / n,
    avgCreditsBurned: r.totalCreditsBurned / n,
    avgCreditsPurchased: r.totalCreditsPurchased / n,
  };
}
