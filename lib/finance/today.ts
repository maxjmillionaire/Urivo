import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usdToEur } from "./cost-model";
import { getPlatformSettings } from "@/lib/platform/settings";
import { monthStart } from "./reporting";
import { planName, type PlanKey } from "@/lib/plans";

/*
 * The two questions a founder actually asks about money, answered from
 * recorded events rather than from a model:
 *
 *   "What has today cost me, and is anything unusual?"
 *   "At this rate, where does the month land?"
 *
 * Month-to-date totals answer neither. A day that costs ten times normal is
 * invisible in a monthly average until the month is over, and by then the money
 * is gone. Everything here is either measured or explicitly a projection.
 */

export interface TodaySnapshot {
  day: string;
  costEur: number;
  anthropicEur: number;
  imageEur: number;
  freeCostEur: number;
  paidCostEur: number;
  revenueEur: number;
  actions: number;
  credits: number;
  users: number;
  /** The costliest surface today — the first place to look when a day is odd. */
  topFeature: string | null;
  topFeatureEur: number;
  topFeatureActions: number;
  /** Gross margin on today's numbers; null when no revenue was recorded. */
  marginPct: number | null;
  /** False when the underlying data could not be read at all. */
  available: boolean;
}

const EMPTY: TodaySnapshot = {
  day: new Date().toISOString().slice(0, 10),
  costEur: 0,
  anthropicEur: 0,
  imageEur: 0,
  freeCostEur: 0,
  paidCostEur: 0,
  revenueEur: 0,
  actions: 0,
  credits: 0,
  users: 0,
  topFeature: null,
  topFeatureEur: 0,
  topFeatureActions: 0,
  marginPct: null,
  available: false,
};

export async function getTodaySnapshot(day?: string): Promise<TodaySnapshot> {
  try {
    const { data, error } = await supabaseAdmin().rpc("finance_today", day ? { p_day: day } : {});
    if (error || !data) return EMPTY;
    const r = data as Record<string, unknown>;
    const num = (v: unknown) => Number(v ?? 0);

    const costEur = usdToEur(num(r.total_cost_usd));
    const revenueEur = num(r.revenue_cents) / 100;

    return {
      day: String(r.day ?? EMPTY.day),
      costEur,
      anthropicEur: usdToEur(num(r.anthropic_usd)),
      imageEur: usdToEur(num(r.image_usd)),
      freeCostEur: usdToEur(num(r.free_cost_usd)),
      paidCostEur: usdToEur(num(r.paid_cost_usd)),
      revenueEur,
      actions: num(r.actions),
      credits: num(r.credits),
      users: num(r.users),
      topFeature: (r.top_feature as string | null) ?? null,
      topFeatureEur: usdToEur(num(r.top_feature_usd)),
      topFeatureActions: num(r.top_feature_actions),
      // Margin on a day with no revenue is not -infinity or zero, it is
      // undefined — and printing a number there would invite reading it.
      marginPct: revenueEur > 0 ? ((revenueEur - costEur) / revenueEur) * 100 : null,
      available: true,
    };
  } catch {
    return EMPTY;
  }
}

export interface BudgetStatus {
  budgetEur: number;
  spentEur: number;
  remainingEur: number;
  usedPct: number;
  /** Straight-line month-end projection from the run rate so far. */
  projectedEur: number;
  daysElapsed: number;
  daysInMonth: number;
  /** True when the projection lands over budget — the actionable state. */
  projectedOver: boolean;
  /** False when no budget has been set; the rest is still meaningful. */
  hasBudget: boolean;
}

/**
 * Spend against the monthly AI budget, plus where the month is heading.
 *
 * The projection is deliberately naive — spend so far ÷ days elapsed × days in
 * month. A cleverer forecast would need a usage model nobody has calibrated
 * yet, and would be a guess with better manners. This one is legible enough
 * that its error is obvious.
 */
export async function getBudgetStatus(spentEur: number, now = new Date()): Promise<BudgetStatus> {
  const settings = await getPlatformSettings();
  const budgetEur = settings.monthlyAiBudgetEur;

  const start = monthStart(now);
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  // At least 1, so the first hours of the month do not project to infinity.
  const daysElapsed = Math.max(
    1,
    Math.ceil((now.getTime() - start.getTime()) / 86_400_000),
  );
  const projectedEur = (spentEur / daysElapsed) * daysInMonth;

  return {
    budgetEur,
    spentEur,
    remainingEur: budgetEur > 0 ? Math.max(0, budgetEur - spentEur) : 0,
    usedPct: budgetEur > 0 ? (spentEur / budgetEur) * 100 : 0,
    projectedEur,
    daysElapsed,
    daysInMonth,
    projectedOver: budgetEur > 0 && projectedEur > budgetEur,
    hasBudget: budgetEur > 0,
  };
}

export interface PlanMargin {
  planKey: string;
  name: string;
  users: number;
  actions: number;
  credits: number;
  costEur: number;
  revenueEur: number;
  /** Null when the plan recorded no revenue this period — undefined, not zero. */
  marginPct: number | null;
  profitEur: number;
}

/**
 * Gross margin per plan with BOTH sides measured: cost from the usage ledger,
 * revenue from recorded Stripe events. This is the figure that says whether a
 * tier is worth selling, so neither half may be modelled.
 */
export async function getMarginByPlan(since: Date = monthStart()): Promise<PlanMargin[]> {
  try {
    const { data, error } = await supabaseAdmin().rpc("finance_margin_by_plan", {
      p_since: since.toISOString(),
    });
    if (error || !Array.isArray(data)) return [];
    return data.map((row) => {
      const r = row as Record<string, unknown>;
      const key = String(r.plan ?? "unknown");
      const costEur = usdToEur(Number(r.cost_usd ?? 0));
      const revenueEur = Number(r.revenue_cents ?? 0) / 100;
      return {
        planKey: key,
        name:
          key === "unattributed"
            ? "Unattributed"
            : (["free", "core", "pro"] as const).includes(key as PlanKey)
              ? planName(key as PlanKey)
              : key,
        users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0),
        credits: Number(r.credits ?? 0),
        costEur,
        revenueEur,
        marginPct: revenueEur > 0 ? ((revenueEur - costEur) / revenueEur) * 100 : null,
        profitEur: revenueEur - costEur,
      };
    });
  } catch {
    return [];
  }
}
