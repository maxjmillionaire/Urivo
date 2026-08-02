import "server-only";
import { notify, notifyOnce } from "./service";

/*
 * Typed merchant events — the non-Stripe operating-loop notifications. Each is a
 * thin, named wrapper over notify()/notifyOnce() so call sites stay readable and
 * the copy lives in one place. (Order / refund / payout / inventory events fire
 * from the Stripe flow and are wired separately when Stripe is live.)
 */

/** The threshold below which a merchant can't generate another store. */
export const LOW_CREDIT_THRESHOLD = 20;

/** Credits crossed below "can't generate another store" — fires once per crossing. */
export async function notifyLowCredits(userId: string, prev: number, next: number): Promise<void> {
  if (prev >= LOW_CREDIT_THRESHOLD && next < LOW_CREDIT_THRESHOLD) {
    await notify(userId, {
      kind: "credits_low",
      title: "You're running low on credits",
      body: `You have ${next} credit${next === 1 ? "" : "s"} left — not enough to generate another store. Top up anytime.`,
      href: "/dashboard/billing",
      severity: "warning",
    });
  }
}

/** The very first store — a milestone worth celebrating (fires only on store #1). */
export async function notifyFirstStore(userId: string, storeId: string, storeName: string): Promise<void> {
  await notify(userId, {
    kind: "milestone",
    title: "Your first store is ready",
    body: `${storeName} is generated — preview it, refine it with Ask Urivo, and publish when it's ready.`,
    href: `/dashboard/stores/${storeId}`,
    severity: "success",
  });
}

/**
 * Payouts are live — the merchant can now actually be paid. Deduped generously:
 * Stripe can re-confirm an account repeatedly, and this should feel like a
 * milestone, not a recurring notice.
 */
export async function notifyPayoutsReady(userId: string): Promise<void> {
  await notifyOnce(
    userId,
    "payouts_ready",
    {
      kind: "payouts_ready",
      title: "Your store can accept payments",
      body: "Payout setup is complete. Orders from your storefronts now pay out to your bank account.",
      href: "/dashboard/billing",
      severity: "success",
    },
    30,
  );
}

/**
 * Stripe disabled charges on a live merchant (failed verification, new
 * requirements). This is money stopping, so it is critical and re-raised weekly
 * until resolved.
 */
export async function notifyPayoutsRestricted(userId: string): Promise<void> {
  await notifyOnce(
    userId,
    "payouts_restricted",
    {
      kind: "payouts_restricted",
      title: "Action needed: your store can't take payments",
      body: "Stripe needs more information before your storefronts can accept orders again. It usually takes a few minutes to resolve.",
      href: "/dashboard/billing",
      severity: "critical",
    },
    7,
  );
}

/** A store went live. Deduped per store per day so toggling doesn't spam. */
export async function notifyStorePublished(userId: string, storeId: string, storeName: string): Promise<void> {
  await notifyOnce(
    userId,
    `store_live:${storeId}`,
    {
      kind: "store_live",
      title: `${storeName} is live`,
      body: `${storeName} is now published and open for orders.`,
      href: `/dashboard/stores/${storeId}`,
      severity: "success",
    },
    1,
  );
}
