import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";
import { logger } from "@/lib/logger";

/*
 * Stripe Connect payout accounts — ONE per merchant (founder decision), stored
 * on profiles. A merchant onboards once and every store they own sells through
 * that account. Urivo never holds merchant money: storefront charges are created
 * directly on the connected account.
 *
 * Stripe is always the authority on whether a merchant can be paid. We mirror
 * charges_enabled / payouts_enabled / details_submitted onto the profile so the
 * dashboard and checkout can read them cheaply, but we never infer them — the
 * mirror is only ever written from a real account object (onboarding return, or
 * the account.updated webhook).
 */

export interface ConnectStatus {
  accountId: string | null;
  /** Stripe will accept charges on this account. The gate for storefront checkout. */
  chargesEnabled: boolean;
  /** Stripe will pay out to the merchant's bank. */
  payoutsEnabled: boolean;
  /** The merchant finished the onboarding form (verification may still be pending). */
  detailsSubmitted: boolean;
}

export type ConnectState =
  | "not_started" // no account yet
  | "in_progress" // account exists, form not finished
  | "pending" // form submitted, Stripe still verifying
  | "ready" // charges enabled — the store can sell
  | "restricted"; // details submitted but Stripe has disabled charges

export const NO_CONNECT: ConnectStatus = {
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};

/** Reduce the mirrored flags to the one state the UI should talk about. */
export function connectState(s: ConnectStatus): ConnectState {
  if (!s.accountId) return "not_started";
  if (s.chargesEnabled) return "ready";
  if (!s.detailsSubmitted) return "in_progress";
  return s.payoutsEnabled ? "pending" : "restricted";
}

/** Read the merchant's mirrored payout state. Never calls Stripe. */
export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted",
    )
    .eq("id", userId)
    .maybeSingle();
  if (!data) return NO_CONNECT;
  return {
    accountId: data.stripe_account_id ?? null,
    chargesEnabled: data.stripe_charges_enabled === true,
    payoutsEnabled: data.stripe_payouts_enabled === true,
    detailsSubmitted: data.stripe_details_submitted === true,
  };
}

/** Write a real Stripe account object onto the profile mirror. */
async function persistAccount(userId: string, account: Stripe.Account): Promise<ConnectStatus> {
  const status: ConnectStatus = {
    accountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  };
  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({
      stripe_account_id: status.accountId,
      stripe_charges_enabled: status.chargesEnabled,
      stripe_payouts_enabled: status.payoutsEnabled,
      stripe_details_submitted: status.detailsSubmitted,
      stripe_account_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`Failed to persist connect account: ${error.message}`);
  return status;
}

/**
 * The merchant's connected account, created on first use. Idempotent: an
 * existing account id is returned untouched, so a merchant who abandons and
 * restarts onboarding never accumulates duplicate accounts.
 */
export async function ensureConnectAccount(
  userId: string,
  email: string | null,
): Promise<string> {
  const existing = await getConnectStatus(userId);
  if (existing.accountId) return existing.accountId;

  const account = await stripe().accounts.create({
    type: "express",
    ...(email ? { email } : {}),
    business_type: "individual",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    // Lets us trace an account back to the merchant from the Stripe dashboard.
    metadata: { urivo_user_id: userId },
  });

  await persistAccount(userId, account);
  logger.info("connect account created", { userId, accountId: account.id });
  return account.id;
}

/**
 * A fresh onboarding link. Stripe account links are single-use and expire in
 * minutes, so one is minted per click rather than stored.
 */
export async function createOnboardingLink(
  accountId: string,
  appUrl: string,
): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    // Stripe sends the merchant here if the link expired before they finished.
    refresh_url: `${appUrl}/api/connect/refresh`,
    return_url: `${appUrl}/api/connect/return`,
  });
  return link.url;
}

/**
 * A link into the merchant's own Stripe Express dashboard (payouts, bank
 * details, tax documents). Only valid once charges are enabled.
 */
export async function createExpressDashboardLink(accountId: string): Promise<string> {
  const link = await stripe().accounts.createLoginLink(accountId);
  return link.url;
}

/**
 * Re-read the account from Stripe and refresh the mirror. Called on the
 * onboarding return leg, where waiting for the webhook would show the merchant
 * a stale "not connected" screen immediately after they finished.
 */
export async function syncConnectAccount(userId: string): Promise<ConnectStatus> {
  const status = await getConnectStatus(userId);
  if (!status.accountId || !isStripeConfigured()) return status;
  try {
    const account = await stripe().accounts.retrieve(status.accountId);
    return await persistAccount(userId, account);
  } catch (err) {
    logger.warn("connect account sync failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return status;
  }
}

/**
 * Apply an account.updated webhook. Stripe can enable OR disable a merchant at
 * any time (failed verification, new requirements), so this is the path that
 * keeps a live store honest about whether it can still take money.
 */
export async function applyAccountUpdate(account: Stripe.Account): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  if (!data) {
    logger.warn("account.updated for an unknown account", { accountId: account.id });
    return;
  }
  await persistAccount(data.id, account);
}
