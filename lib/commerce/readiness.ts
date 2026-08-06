import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStripeConfigured } from "@/lib/commerce/stripe";

/*
 * Can this store actually take money?
 *
 * ONE definition, shared by every surface that needs the answer: the checkout
 * route that refuses the charge, the storefront that warns the shopper before
 * they fill a cart, and the dashboard that tells the merchant. Three copies of
 * this rule would drift, and the copy that drifted would be the one letting a
 * customer reach a checkout that cannot complete.
 *
 * Payout accounts belong to the MERCHANT, not the store (migration 0026), so
 * the answer is resolved from the store's owner through store_payout_account —
 * a service_role RPC, which is why callers pass an admin client.
 */

export type SellBlocker =
  /** Urivo itself has no Stripe keys — a platform problem, not the merchant's. */
  | "platform"
  /** The merchant has never started Connect onboarding. */
  | "no_account"
  /** Onboarding started but Stripe will not accept charges yet. */
  | "charges_disabled";

export interface SellReadiness {
  canSell: boolean;
  blocker: SellBlocker | null;
  accountId: string | null;
}

const READY: SellReadiness = { canSell: true, blocker: null, accountId: null };

/**
 * Resolve payment readiness for a store. Fails CLOSED: any error answers "not
 * ready", because letting a shopper reach a checkout that cannot complete is
 * worse than showing a setup notice to a store that could actually sell.
 */
export async function storeSellReadiness(
  admin: SupabaseClient,
  storeId: string,
): Promise<SellReadiness> {
  if (!isStripeConfigured()) return { canSell: false, blocker: "platform", accountId: null };

  try {
    const { data, error } = await admin.rpc("store_payout_account", { p_store_id: storeId });
    if (error) return { canSell: false, blocker: "no_account", accountId: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { stripe_account_id: string | null; charges_enabled: boolean }
      | null
      | undefined;

    const accountId = row?.stripe_account_id ?? null;
    if (!accountId) return { canSell: false, blocker: "no_account", accountId: null };
    if (row?.charges_enabled !== true) {
      return { canSell: false, blocker: "charges_disabled", accountId };
    }
    return { ...READY, accountId };
  } catch {
    return { canSell: false, blocker: "no_account", accountId: null };
  }
}

/**
 * What the SHOPPER is told. Never mentions Stripe, the merchant's account, or
 * anything about the seller's setup — a customer is owed a clear, calm reason
 * they cannot buy right now, not a look inside someone else's admin.
 */
export function shopperNotice(blocker: SellBlocker): { title: string; detail: string } {
  return blocker === "platform"
    ? {
        title: "Ordering is temporarily unavailable",
        detail: "We're restoring checkout for this store. Everything here is still browsable.",
      }
    : {
        title: "This store is completing its payment setup",
        detail: "You can browse the full collection — orders open as soon as setup finishes.",
      };
}

/**
 * What the MERCHANT is told. Names the real problem and the real next step.
 */
export function merchantNotice(blocker: SellBlocker): { title: string; detail: string; action: string | null } {
  switch (blocker) {
    case "platform":
      return {
        title: "Payments are unavailable platform-wide",
        detail: "This is on our side, not yours. Your store stays live and we're on it.",
        action: null,
      };
    case "charges_disabled":
      return {
        title: "Stripe still needs a few details",
        detail:
          "Your account exists but Stripe hasn't enabled charges yet — usually one missing document or detail. Finish it and orders start flowing.",
        action: "Finish Stripe setup",
      };
    default:
      return {
        title: "Your store is live but cannot accept payments yet",
        detail: "Connect Stripe to start receiving orders. It takes a couple of minutes.",
        action: "Connect Stripe",
      };
  }
}
