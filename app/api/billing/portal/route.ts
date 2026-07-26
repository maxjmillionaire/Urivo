import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Billing portal — opens the Stripe Customer Portal so a subscriber can update
 * payment details, switch plans, or cancel. Stripe owns the cancellation UI and
 * dunning, so this is the one true place plan CHANGES happen for an existing
 * subscriber (see /api/checkout, which only handles new subscriptions).
 */

function appOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error: "BILLING_UNAVAILABLE",
        message:
          "Subscription management opens at launch. Reach us at urivosupport@gmail.com and we'll help right away.",
      },
      { status: 503 },
    );
  }

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json(
      { error: "NO_CUSTOMER", message: "You don't have a billing account yet. Subscribe to get started." },
      { status: 409 },
    );
  }

  const requestId = newRequestId();
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appOrigin()}/dashboard/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    captureException(err, { requestId, route: "billing-portal" });
    return NextResponse.json(
      { error: "PORTAL_FAILED", message: "We couldn't open billing just now. Please try again." },
      { status: 502 },
    );
  }
}
