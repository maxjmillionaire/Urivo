import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Decision Intelligence — the self-improving policy engine.
 *
 * Every AI decision is an experiment. A `policy` (e.g. pricing) has a set of
 * `arms` (strategies). For each store we CHOOSE an arm (exploiting what has won
 * in this niche, exploring under-tested arms), LOG it, and later attribute the
 * store's real outcomes back to it. Over time the engine learns which decisions
 * outperform per niche and picks them by default — a policy that improves itself,
 * not just a recommender.
 *
 * Selection is an ε-greedy bandit with a cold-start guarantee: every arm gets a
 * minimum sample before we trust any winner, so early noise can't lock us in.
 */

export const POLICIES = {
  // How to price a sourced product.
  pricing: ["anchor_intent", "margin_60", "margin_68", "premium"],
  // The Urivo Score floor for accepting a candidate.
  selection: ["min50", "min60", "min68"],
  // Which product becomes the hero (position 0).
  hero: ["top_score", "top_margin", "first_intent"],
  // The voice the copy optimizer writes in.
  copy_style: ["editorial", "benefit", "sensory"],
} as const;

export type Policy = keyof typeof POLICIES;
export type Arm = string;
export type RunArms = Record<Policy, Arm>;

const MIN_SAMPLE = 20; // stores per arm before a winner is trusted
const EPSILON = 0.1; // continued exploration once warmed up

export function normalizeNiche(niche: string | null | undefined): string {
  return (niche ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
}

interface PerfRow {
  policy: string;
  arm: string;
  stores: number;
  orders: number;
  refunds: number;
  removals: number;
  repeat_orders: number;
  revenue_cents: number;
}

/** Composite performance: revenue per store, penalised by refunds + removals,
 *  rewarded for repeat purchases. This is what the bandit maximises. */
function perf(r: PerfRow | undefined): number {
  if (!r || r.stores === 0) return 0;
  const revPerStore = r.revenue_cents / r.stores;
  const refundRate = r.orders > 0 ? r.refunds / r.orders : 0;
  const repeatRate = r.orders > 0 ? r.repeat_orders / r.orders : 0;
  const removalRate = r.stores > 0 ? r.removals / r.stores : 0;
  return revPerStore * (1 - refundRate) * (1 - Math.min(0.5, removalRate)) * (1 + repeatRate);
}

const rand = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

function pickArm(policy: Policy, byArm: Map<string, PerfRow>): Arm {
  const arms = POLICIES[policy];
  // Cold-start: guarantee every arm reaches MIN_SAMPLE before trusting a winner.
  const under = arms.filter((a) => (byArm.get(`${policy}:${a}`)?.stores ?? 0) < MIN_SAMPLE);
  if (under.length) return rand(under);
  // Warmed up: mostly exploit the best, occasionally keep exploring.
  if (Math.random() < EPSILON) return rand(arms);
  return arms.reduce((best, a) =>
    perf(byArm.get(`${policy}:${a}`)) > perf(byArm.get(`${policy}:${best}`)) ? a : best,
  );
}

/**
 * Choose an arm for every policy for a store in this niche — the bandit's
 * decision for this run. One query for all policies.
 */
export async function selectRun(niche: string): Promise<RunArms> {
  const key = normalizeNiche(niche);
  const { data } = await supabaseAdmin()
    .from("decision_performance")
    .select("policy, arm, stores, orders, refunds, removals, repeat_orders, revenue_cents")
    .eq("niche", key)
    .in("policy", Object.keys(POLICIES));
  const byArm = new Map<string, PerfRow>();
  for (const r of (data ?? []) as PerfRow[]) byArm.set(`${r.policy}:${r.arm}`, r);

  return {
    pricing: pickArm("pricing", byArm),
    selection: pickArm("selection", byArm),
    hero: pickArm("hero", byArm),
    copy_style: pickArm("copy_style", byArm),
  };
}

/** Log every chosen arm as an experiment for this store. Best-effort. */
export async function recordRun(
  storeId: string,
  userId: string,
  niche: string,
  arms: RunArms,
  context?: Record<string, unknown>,
): Promise<void> {
  const key = normalizeNiche(niche);
  const admin = supabaseAdmin();
  await Promise.all(
    (Object.keys(arms) as Policy[]).map(async (policy) => {
      try {
        await admin.rpc("record_ai_decision", {
          p_store_id: storeId,
          p_user_id: userId,
          p_policy: policy,
          p_arm: arms[policy],
          p_niche: key,
          p_context: (context ?? null) as object | null,
        });
      } catch {
        /* intelligence never breaks the user action */
      }
    }),
  );
}

/**
 * Attribute a store-level outcome to every decision that shaped it. Called from
 * the order/refund/removal flow (Stripe, Phase 2 — removals available now).
 * Best-effort.
 */
export async function attributeStoreOutcome(
  storeId: string,
  event: "impression" | "order" | "refund" | "removal" | "repeat",
  valueCents = 0,
): Promise<void> {
  try {
    await supabaseAdmin().rpc("attribute_store_outcome", {
      p_store_id: storeId,
      p_event: event,
      p_value_cents: valueCents,
    });
  } catch {
    /* intelligence never breaks the user action */
  }
}

export interface ArmReport {
  policy: Policy;
  arm: Arm;
  stores: number;
  orders: number;
  refundRatePct: number;
  repeatRatePct: number;
  revenuePerStoreEur: number;
  performance: number;
  leading: boolean;
}

/** Per-arm performance for the admin/intelligence view. */
export async function policyReport(niche?: string): Promise<ArmReport[]> {
  const q = supabaseAdmin()
    .from("decision_performance")
    .select("policy, arm, stores, orders, refunds, removals, repeat_orders, revenue_cents");
  const { data } = niche ? await q.eq("niche", normalizeNiche(niche)) : await q;
  const rows = (data ?? []) as PerfRow[];

  const best = new Map<string, number>();
  for (const r of rows) best.set(r.policy, Math.max(best.get(r.policy) ?? 0, perf(r)));

  return rows
    .map((r) => ({
      policy: r.policy as Policy,
      arm: r.arm,
      stores: Number(r.stores),
      orders: Number(r.orders),
      refundRatePct: r.orders > 0 ? Math.round((r.refunds / r.orders) * 1000) / 10 : 0,
      repeatRatePct: r.orders > 0 ? Math.round((r.repeat_orders / r.orders) * 1000) / 10 : 0,
      revenuePerStoreEur: r.stores > 0 ? Math.round(r.revenue_cents / r.stores) / 100 : 0,
      performance: Math.round(perf(r)) / 100,
      leading: perf(r) > 0 && perf(r) === best.get(r.policy),
    }))
    .sort((a, b) => (a.policy === b.policy ? b.performance - a.performance : a.policy.localeCompare(b.policy)));
}
