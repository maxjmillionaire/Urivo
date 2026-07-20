import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Billing portal entry point (Phase 2 boundary).
 *
 * Opens the Stripe Customer Portal so a subscriber can update payment details,
 * change plan, or cancel — Stripe owns the cancellation UI and dunning. The
 * auth is complete here; the Stripe integration (resolve the customer id from
 * profiles.stripe_customer_id, create a billingPortal.session with a return
 * URL) is Phase 2 and needs STRIPE_SECRET_KEY + the live domain. Until then it
 * degrades gracefully (spec 6.9), mirroring /api/checkout.
 */

export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Please sign in." },
      { status: 401 },
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "BILLING_UNAVAILABLE",
        message: "Subscription management opens at launch. Reach us at urivosupport@gmail.com and we'll help right away.",
      },
      { status: 503 },
    );
  }

  // Phase 2: look up the caller's stripe_customer_id and create a billing
  // portal session, returning session.url for the frontend to redirect to.
  return NextResponse.json(
    { error: "NOT_IMPLEMENTED", message: "Subscription management is being finalised." },
    { status: 501 },
  );
}
