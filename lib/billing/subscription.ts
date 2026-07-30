import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlan, planName, type PlanKey } from "@/lib/plans";
import { getCreditPack } from "@/lib/credit-packs";
import { userIdForCustomer } from "./customer";
import { sendEmail } from "@/lib/email/service";
import {
  subscriptionConfirmedEmail,
  paymentSucceededEmail,
  paymentFailedEmail,
  subscriptionCancelledEmail,
} from "@/lib/email/templates";
import { logger } from "@/lib/logger";

/*
 * Subscription lifecycle — the platform side of billing.
 *
 * Two responsibilities live here:
 *  1. Granting credits (monthly allowance + one-time packs), driven by PAID
 *     events so credits always follow money. Both grants are idempotent.
 *  2. Keeping profiles in sync with Stripe's subscription state (plan, status,
 *     current period, ids) so the product can gate features and the billing
 *     surface can render "renews on …" without a round-trip to Stripe.
 *
 * The Stripe webhook is the ONLY caller. Everything here runs with the service
 * role and is safe to re-run on webhook retries.
 */

// ------------------------------------------------------------------
// Credit granting
// ------------------------------------------------------------------

/*
 * Monthly allowance. Granted from invoice.paid (subscription_create AND
 * subscription_cycle) keyed by the invoice id, so the first month and every
 * renewal each grant exactly once and a webhook retry is a no-op.
 */
export async function grantMonthlyCredits(
  userId: string,
  planKey: PlanKey,
  periodKey: string,
  expiresAt: Date | null = null,
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
    // Plan credits are use-it-or-lose-it: they lapse at the end of the period
    // they were granted for. Purchased packs (grantCreditPack) never expire.
    expires_at: expiresAt ? expiresAt.toISOString() : null,
  });
  if (error) throw new Error(`Failed to grant monthly credits: ${error.message}`);

  return { granted: true, amount: plan.monthlyCredits };
}

/*
 * Credit-pack top-up. Called from the webhook on checkout.session.completed for
 * a one-time credit-pack purchase. Idempotent — the ledger reason encodes the
 * Stripe session id, so a webhook retry is a no-op.
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

// ------------------------------------------------------------------
// Subscription state → profile sync
// ------------------------------------------------------------------

type SubStatus = "none" | "active" | "past_due" | "cancelled";

/** Map Stripe's granular status to the four states the product reasons about. */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      // incomplete / paused — not yet a paying subscription.
      return "none";
  }
}

/** Coerce a Stripe field that may be an id string or an expanded object. */
function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/**
 * The end of the current paid period. In the current Stripe API this lives on
 * the subscription's items (not the subscription root), so read it from the
 * first item and fall back to null.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const unix = sub.items?.data?.[0]?.current_period_end;
  return typeof unix === "number" ? new Date(unix * 1000) : null;
}

/** The plan a subscription represents, taken from the metadata we set at checkout. */
export function planFromSubscription(sub: Stripe.Subscription): PlanKey {
  const p = sub.metadata?.plan;
  return p === "core" || p === "pro" ? p : "free";
}

/** Resolve the owning user for a subscription: metadata first, then customer. */
export async function resolveUserForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id;
  if (fromMeta) return fromMeta;
  const customerId = idOf(sub.customer);
  return customerId ? userIdForCustomer(customerId) : null;
}

interface SubStateInput {
  userId: string;
  planKey: PlanKey;
  status: SubStatus;
  subscriptionId: string | null;
  customerId: string | null;
  currentPeriodEnd: Date | null;
  priceType: "standard" | "launch" | "creator";
}

/** Persist the resolved subscription state onto the profile. */
async function applySubscriptionState(input: SubStateInput): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({
      plan: input.planKey,
      subscription_status: input.status,
      price_type: input.priceType,
      stripe_customer_id: input.customerId ?? undefined,
      stripe_subscription_id: input.subscriptionId,
      current_period_end: input.currentPeriodEnd?.toISOString() ?? null,
    })
    .eq("id", input.userId);
  if (error) throw new Error(`Failed to sync subscription state: ${error.message}`);
}

function priceTypeOf(sub: Stripe.Subscription): "standard" | "launch" | "creator" {
  const t = sub.metadata?.price_type;
  return t === "launch" || t === "creator" ? t : "standard";
}

async function profileEmail(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("profiles").select("email").eq("id", userId).maybeSingle();
  return data?.email ?? null;
}

/**
 * Activate a subscription from checkout.session.completed. Sets the plan live so
 * the customer has access the instant they return from Checkout; the monthly
 * credits are granted separately by invoice.paid. Sends the welcome email once.
 */
export async function linkSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const planKey = planFromSubscription(sub);

  // Was this profile already on this subscription? (Avoids a duplicate welcome
  // email if checkout.completed is redelivered.)
  const { data: before } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();
  const isNew = before?.stripe_subscription_id !== sub.id;

  await applySubscriptionState({
    userId,
    planKey,
    status: mapStripeStatus(sub.status),
    subscriptionId: sub.id,
    customerId: idOf(sub.customer),
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    priceType: priceTypeOf(sub),
  });

  if (isNew && planKey !== "free") {
    const email = await profileEmail(userId);
    if (email) {
      await sendEmail({
        to: email,
        email: subscriptionConfirmedEmail(planName(planKey), subscriptionPriceLine(sub)),
      });
    }
  }
}

/** A human price line for the welcome email, from what the subscription charges. */
function subscriptionPriceLine(sub: Stripe.Subscription): string {
  const price = sub.items?.data?.[0]?.price;
  const cents = price?.unit_amount ?? null;
  if (cents == null) return "";
  const currency = (price?.currency ?? "eur").toUpperCase();
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `You'll be billed ${symbol}${amount}/month.`;
}

/**
 * Sync from customer.subscription.updated — plan changes, renewals, entering or
 * recovering from past_due, and cancel-at-period-end (still active until the end
 * of the paid period). Emails on the transition INTO past_due, once.
 */
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserForSubscription(sub);
  if (!userId) {
    logger.info("Subscription update for unknown user", { subscription: sub.id });
    return;
  }
  const nextStatus = mapStripeStatus(sub.status);

  const { data: before } = await supabaseAdmin()
    .from("profiles")
    .select("subscription_status")
    .eq("id", userId)
    .maybeSingle();
  const prevStatus = before?.subscription_status;

  await applySubscriptionState({
    userId,
    planKey: planFromSubscription(sub),
    status: nextStatus,
    subscriptionId: sub.id,
    customerId: idOf(sub.customer),
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    priceType: priceTypeOf(sub),
  });

  if (nextStatus === "past_due" && prevStatus !== "past_due") {
    const email = await profileEmail(userId);
    if (email) await sendEmail({ to: email, email: paymentFailedEmail() });
  }
}

/**
 * Handle customer.subscription.deleted — the subscription is fully gone. Drop to
 * Free, clear the ids, and email the cancellation confirmation.
 */
export async function cancelSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserForSubscription(sub);
  if (!userId) return;

  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({
      plan: "free",
      subscription_status: "cancelled",
      stripe_subscription_id: null,
      current_period_end: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`Failed to cancel subscription: ${error.message}`);

  const email = await profileEmail(userId);
  if (email) await sendEmail({ to: email, email: subscriptionCancelledEmail() });
}

/**
 * Renewal receipt on a subscription_cycle invoice — a light monthly touch, sent
 * only for genuine renewals (not the first invoice, which the welcome covers).
 */
export async function sendRenewalReceipt(userId: string, amountFormatted: string): Promise<void> {
  const email = await profileEmail(userId);
  if (email) await sendEmail({ to: email, email: paymentSucceededEmail(amountFormatted) });
}
