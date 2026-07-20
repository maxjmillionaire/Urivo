import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlan, type PlanKey } from "@/lib/plans";
import { getCreditPack } from "@/lib/credit-packs";

/*
 * Subscription credit granting.
 *
 * Paid tiers receive their monthly credit allowance at the start of each billing
 * period. This is the Phase-2 hook: the platform's Stripe subscription webhook
 * (invoice.paid / customer.subscription.created) calls grantMonthlyCredits with
 * the invoice's period so credits top up on every renewal. It is idempotent — a
 * webhook retry, or two events for the same period, grant the allowance once.
 *
 * `periodKey` is any stable identifier for the billing period (e.g. the Stripe
 * invoice id, or `YYYY-MM` for a manual grant).
 */

export async function grantMonthlyCredits(
  userId: string,
  planKey: PlanKey,
  periodKey: string,
): Promise<{ granted: boolean; amount: number }> {
  const plan = getPlan(planKey);
  if (plan.monthlyCredits <= 0) return { granted: false, amount: 0 };

  const admin = supabaseAdmin();
  const reason = `${plan.name} monthly credits · ${periodKey}`;

  // Idempotency: the reason encodes the period, so a repeat is a no-op.
  const { data: existing } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", reason)
    .maybeSingle();
  if (existing) return { granted: false, amount: 0 };

  const { error } = await admin.from("credit_ledger").insert({
    user_id: userId,
    delta: plan.monthlyCredits,
    reason,
    source: "subscription",
  });
  if (error) throw new Error(`Failed to grant monthly credits: ${error.message}`);

  return { granted: true, amount: plan.monthlyCredits };
}

/*
 * Credit-pack top-up granting. Called from the Stripe webhook on
 * checkout.session.completed for a one-time credit-pack purchase. Idempotent —
 * the ledger reason encodes the Stripe session id, so a webhook retry is a no-op.
 */
export async function grantCreditPack(
  userId: string,
  packId: string,
  sessionId: string,
): Promise<{ granted: boolean; amount: number }> {
  const pack = getCreditPack(packId);
  if (!pack) return { granted: false, amount: 0 };

  const admin = supabaseAdmin();
  const reason = `${pack.name} credit pack · ${sessionId}`;

  const { data: existing } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", reason)
    .maybeSingle();
  if (existing) return { granted: false, amount: 0 };

  const { error } = await admin.from("credit_ledger").insert({
    user_id: userId,
    delta: pack.credits,
    reason,
    source: "credit_pack",
  });
  if (error) throw new Error(`Failed to grant credit pack: ${error.message}`);

  return { granted: true, amount: pack.credits };
}
