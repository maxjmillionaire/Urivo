import "server-only";
import { stripe } from "@/lib/commerce/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Stripe customer resolution for PLATFORM billing (subscriptions + credit
 * packs) — distinct from storefront Connect charges, which never touch a
 * platform customer.
 *
 * Every user maps to exactly one Stripe customer, stored on profiles.
 * stripe_customer_id. We resolve-or-create lazily at the first checkout so a
 * customer record only exists for people who actually try to pay. The customer
 * carries `metadata.user_id` so a webhook can always recover the owner even if
 * the id column were ever out of sync.
 */

export async function resolveStripeCustomer(userId: string, email: string | null): Promise<string> {
  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  const existing = profile?.stripe_customer_id;
  if (existing) return existing;

  const customer = await stripe().customers.create({
    ...(email ? { email } : {}),
    metadata: { user_id: userId },
  });

  // Persist immediately so a second checkout (or a webhook that races the
  // redirect) reuses the same customer instead of minting a duplicate.
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);

  return customer.id;
}

/** Resolve the profile that owns a Stripe customer id (webhook → user). */
export async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}
