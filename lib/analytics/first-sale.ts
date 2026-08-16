import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/*
 * First-sale funnel — the metric the business is steered by.
 *
 * What share of merchants make a real sale after publishing, and how long it
 * takes them. Churn, LTV, word of mouth and whether the product works at all
 * are downstream of this one number, so it gets its own surface rather than
 * being buried in general analytics.
 *
 * Counts PAID and FULFILLED orders only — a pending checkout is not a sale.
 */

export interface FirstSaleFunnel {
  storesPublished: number;
  storesWithSale: number;
  /** Percent of published stores that have ever sold. The headline number. */
  firstSaleRate: number;
  soldWithin7d: number;
  soldWithin30d: number;
  soldWithin90d: number;
  /** Percent selling inside 30 days — the leading indicator, before churn shows up. */
  rateWithin30d: number;
  medianDaysToFirstSale: number | null;
  avgDaysToFirstSale: number | null;
}

export interface FirstSaleCohort {
  cohortWeek: string;
  storesPublished: number;
  storesWithSale: number;
  firstSaleRate: number;
  medianDaysToFirstSale: number | null;
}

const EMPTY: FirstSaleFunnel = {
  storesPublished: 0,
  storesWithSale: 0,
  firstSaleRate: 0,
  soldWithin7d: 0,
  soldWithin30d: 0,
  soldWithin90d: 0,
  rateWithin30d: 0,
  medianDaysToFirstSale: null,
  avgDaysToFirstSale: null,
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const nullableNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Whole-business first-sale funnel. `since` narrows to stores published after a date. */
export async function getFirstSaleFunnel(since?: Date): Promise<FirstSaleFunnel> {
  const { data, error } = await supabaseAdmin().rpc("first_sale_funnel", {
    p_since: since ? since.toISOString() : "-infinity",
  });
  if (error) {
    logger.warn("first_sale_funnel failed", { error: error.message });
    return EMPTY;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return EMPTY;
  return {
    storesPublished: num(row.stores_published),
    storesWithSale: num(row.stores_with_sale),
    firstSaleRate: num(row.first_sale_rate),
    soldWithin7d: num(row.sold_within_7d),
    soldWithin30d: num(row.sold_within_30d),
    soldWithin90d: num(row.sold_within_90d),
    rateWithin30d: num(row.rate_within_30d),
    medianDaysToFirstSale: nullableNum(row.median_days_to_first_sale),
    avgDaysToFirstSale: nullableNum(row.avg_days_to_first_sale),
  };
}

/**
 * The same question by publish cohort. A blended rate hides whether the product
 * is improving — the cohort curve is what shows whether a change actually worked.
 */
export async function getFirstSaleCohorts(weeks = 12): Promise<FirstSaleCohort[]> {
  const { data, error } = await supabaseAdmin().rpc("first_sale_cohorts", { p_weeks: weeks });
  if (error) {
    logger.warn("first_sale_cohorts failed", { error: error.message });
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    cohortWeek: String(r.cohort_week),
    storesPublished: num(r.stores_published),
    storesWithSale: num(r.stores_with_sale),
    firstSaleRate: num(r.first_sale_rate),
    medianDaysToFirstSale: nullableNum(r.median_days_to_first_sale),
  }));
}

/*
 * The thresholds we agreed to steer by. Stated in code so the dashboard reads
 * the same judgement every time instead of leaving it to whoever is looking.
 */
export const FIRST_SALE_HEALTHY = 25;
export const FIRST_SALE_CRITICAL = 10;

export type FirstSaleVerdict = "healthy" | "watch" | "critical" | "no_data";

export function firstSaleVerdict(f: FirstSaleFunnel): FirstSaleVerdict {
  if (f.storesPublished === 0) return "no_data";
  if (f.firstSaleRate >= FIRST_SALE_HEALTHY) return "healthy";
  if (f.firstSaleRate < FIRST_SALE_CRITICAL) return "critical";
  return "watch";
}
