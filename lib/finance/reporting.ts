import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlan, PLANS, type PlanKey, monthlyPrice } from "@/lib/plans";
import { usdToEur } from "./cost-model";
import { simulateTier } from "./simulator";
import { arpu, arppu, grossMarginPct } from "./kpis";

/*
 * Finance reporting — assembles the admin dashboard's data from the two ledgers
 * plus the plan config. Cost is REAL (from ai_usage_ledger); revenue is a proxy
 * from active subscriptions until Stripe lands in Phase 2 (clearly labelled).
 *
 * Server-only. Callers must admin-gate before invoking (isAdminEmail).
 */

export interface FeatureRow {
  feature: string;
  actions: number;
  credits: number;
  costUsd: number;
  costEur: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
}

export interface TopUser {
  userId: string;
  email: string;
  actions: number;
  credits: number;
  costUsd: number;
  costEur: number;
}

export interface TierRollup {
  planKey: PlanKey;
  name: string;
  activeSubscribers: number;
  monthlyPriceEur: number;
  mrrEur: number;
  modeledMarginRealisticPct: number;
  modeledMarginWorstPct: number;
}

export interface FinanceSnapshot {
  periodStart: string;
  // Cost (real)
  actionCount: number;
  activeUsers: number;
  totalCostEur: number;
  anthropicCostEur: number;
  imageCostEur: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  byFeature: FeatureRow[];
  topUsers: TopUser[];
  // Credits (real)
  creditsBurned: number;
  creditsGranted: number;
  // Revenue (proxy until Stripe)
  mrrEur: number;
  arrEur: number;
  payingSubscribers: number;
  totalUsers: number;
  arpuEur: number;
  arppuEur: number;
  grossMarginPct: number;
  avgCostPerActiveUserEur: number;
  tiers: TierRollup[];
  revenueIsProxy: true;
}

interface OverviewJson {
  action_count: number;
  total_cost_usd: number;
  anthropic_cost_usd: number;
  image_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
  active_users: number;
  credits_burned: number;
  credits_granted: number;
  by_feature: {
    feature: string;
    actions: number;
    credits: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    images: number;
  }[];
}

/** Start of the current calendar month (UTC). */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getFinanceSnapshot(since: Date = monthStart()): Promise<FinanceSnapshot> {
  const admin = supabaseAdmin();
  const sinceIso = since.toISOString();

  const [overviewRes, topUsersRes, planDistRes] = await Promise.all([
    admin.rpc("finance_overview", { p_since: sinceIso }),
    admin.rpc("finance_top_users", { p_since: sinceIso, p_limit: 10 }),
    admin.rpc("finance_plan_distribution"),
  ]);

  const o = (overviewRes.data ?? {}) as Partial<OverviewJson>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

  const byFeature: FeatureRow[] = (o.by_feature ?? []).map((f) => ({
    feature: f.feature,
    actions: num(f.actions),
    credits: num(f.credits),
    costUsd: num(f.cost_usd),
    costEur: usdToEur(num(f.cost_usd)),
    inputTokens: num(f.input_tokens),
    outputTokens: num(f.output_tokens),
    images: num(f.images),
  }));

  const topUsers: TopUser[] = ((topUsersRes.data ?? []) as {
    user_id: string;
    email: string;
    actions: number;
    credits: number;
    cost_usd: number;
  }[]).map((u) => ({
    userId: u.user_id,
    email: u.email,
    actions: num(u.actions),
    credits: num(u.credits),
    costUsd: num(u.cost_usd),
    costEur: usdToEur(num(u.cost_usd)),
  }));

  // Revenue proxy from active subscriptions per plan (net EUR; VAT handled
  // downstream per customer). Until Stripe, "active" comes from profiles.
  const dist = (planDistRes.data ?? []) as {
    plan: string;
    subscription_status: string;
    users: number;
  }[];
  const totalUsers = dist.reduce((s, r) => s + num(r.users), 0);

  const activeByPlan = (key: PlanKey): number =>
    dist
      .filter((r) => r.plan === key && r.subscription_status === "active")
      .reduce((s, r) => s + num(r.users), 0);

  const tiers: TierRollup[] = (["core", "pro"] as PlanKey[]).map((key) => {
    const plan = getPlan(key);
    const price = monthlyPrice(key);
    const subs = activeByPlan(key);
    const econ = simulateTier({ priceEur: price, monthlyCredits: plan.monthlyCredits });
    return {
      planKey: key,
      name: plan.name,
      activeSubscribers: subs,
      monthlyPriceEur: price,
      mrrEur: subs * price,
      modeledMarginRealisticPct: econ.marginRealisticPct,
      modeledMarginWorstPct: econ.marginWorstPct,
    };
  });

  const mrrEur = tiers.reduce((s, t) => s + t.mrrEur, 0);
  const payingSubscribers = tiers.reduce((s, t) => s + t.activeSubscribers, 0);
  const totalCostEur = usdToEur(num(o.total_cost_usd));
  const activeUsers = num(o.active_users);

  return {
    periodStart: sinceIso,
    actionCount: num(o.action_count),
    activeUsers,
    totalCostEur,
    anthropicCostEur: usdToEur(num(o.anthropic_cost_usd)),
    imageCostEur: usdToEur(num(o.image_cost_usd)),
    inputTokens: num(o.input_tokens),
    outputTokens: num(o.output_tokens),
    images: num(o.images),
    byFeature,
    topUsers,
    creditsBurned: num(o.credits_burned),
    creditsGranted: num(o.credits_granted),
    mrrEur,
    arrEur: mrrEur * 12,
    payingSubscribers,
    totalUsers,
    arpuEur: arpu(mrrEur, totalUsers),
    arppuEur: arppu(mrrEur, payingSubscribers),
    grossMarginPct: grossMarginPct({ revenue: mrrEur, variableCogs: totalCostEur }),
    avgCostPerActiveUserEur: activeUsers > 0 ? totalCostEur / activeUsers : 0,
    tiers,
    revenueIsProxy: true,
  };
}

export interface ActionCostRow {
  feature: string;
  model: string;
  actions: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgImages: number;
  avgCostEur: number;
  creditsPerAction: number;
  /** avgCostEur / creditsPerAction — the mispricing signal. If pricing matched
   *  cost this would be roughly constant across every action type. */
  costPerCreditEur: number;
}

/*
 * Measured cost per action type, by model (part 5.2). Reporting only — this
 * derives the true unit cost from the usage ledger so the founder can compare it
 * to the credit table and reprice on data, after real volume. It changes no
 * pricing.
 */
export async function costPerActionReport(since: Date = monthStart()): Promise<ActionCostRow[]> {
  const admin = supabaseAdmin();
  const { data } = await admin.rpc("finance_cost_per_action", { p_since: since.toISOString() });
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
  const rows = (data ?? []) as {
    feature: string;
    model: string;
    actions: number;
    credits: number;
    input_tokens: number;
    output_tokens: number;
    images: number;
    total_cost_usd: number;
  }[];
  return rows.map((r) => {
    const actions = num(r.actions) || 1;
    const avgCostEur = usdToEur(num(r.total_cost_usd)) / actions;
    const creditsPerAction = num(r.credits) / actions;
    return {
      feature: r.feature,
      model: r.model,
      actions: num(r.actions),
      avgInputTokens: Math.round(num(r.input_tokens) / actions),
      avgOutputTokens: Math.round(num(r.output_tokens) / actions),
      avgImages: num(r.images) / actions,
      avgCostEur,
      creditsPerAction,
      costPerCreditEur: creditsPerAction > 0 ? avgCostEur / creditsPerAction : 0,
    };
  });
}

/** The modeled current-tier economics (for the simulator panel — no live data needed). */
export function modeledTiers() {
  return (["free", "core", "pro"] as PlanKey[]).map((key) => {
    const plan = PLANS[key];
    const price = monthlyPrice(key);
    const econ = simulateTier({ priceEur: price, monthlyCredits: plan.monthlyCredits });
    return { key, name: plan.name, price, credits: plan.monthlyCredits, econ };
  });
}
