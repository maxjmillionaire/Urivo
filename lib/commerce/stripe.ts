import "server-only";
import Stripe from "stripe";

/*
 * Stripe client — SERVER ONLY. Isolated here so the rest of commerce depends on
 * one module (spec 6.9). Storefront payments use Stripe Connect: the charge is
 * created on the merchant's connected account, so the merchant receives their
 * own money and Urivo never holds it.
 *
 * When STRIPE_SECRET_KEY is unset the whole commerce surface degrades
 * gracefully (checkout returns a clean "not available yet"), exactly like the
 * platform billing entry point — nothing throws at import time.
 */

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  // Pin to the SDK's built-in API version (avoids drift across upgrades).
  cached = new Stripe(key, {
    appInfo: { name: "Urivo Commerce" },
    typescript: true,
  });
  return cached;
}
