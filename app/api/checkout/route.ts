import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";
import { resolveStripeCustomer } from "@/lib/billing/customer";
import { getPlan, monthlyPrice, isLaunchWindow } from "@/lib/plans";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Subscription checkout — opens a Stripe Checkout Session (subscription mode)
 * for a NEW subscriber (Free → Founder/Pro). Pricing is resolved from
 * lib/plans (the single source of truth) and passed inline as price_data so
 * plans.ts stays authoritative — no Stripe dashboard price ids to keep in sync.
 *
 * Plan CHANGES for an existing subscriber (upgrade/downgrade/cancel) go through
 * the Customer Portal (/api/billing/portal), so this route refuses when the
 * caller already holds an active subscription — that prevents minting a second,
 * parallel subscription. Credits and access are granted by the webhook, never
 * here (the client can't be trusted to confirm payment).
 */

const BodySchema = z.object({ plan: z.enum(["core", "pro"]) });

function appOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Unknown plan." }, { status: 400 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "BILLING_UNAVAILABLE", message: "Paid plans open at launch. Thanks for your interest!" },
      { status: 503 },
    );
  }

  // Existing subscribers change plans via the portal, not a fresh subscription.
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("subscription_status, stripe_subscription_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.stripe_subscription_id && profile.subscription_status === "active") {
    return NextResponse.json(
      { error: "ALREADY_SUBSCRIBED", message: "You already have an active plan. Manage it from Billing." },
      { status: 409 },
    );
  }

  const plan = getPlan(body.plan);
  const priceEUR = monthlyPrice(body.plan);
  const priceType = isLaunchWindow() ? "launch" : "standard";
  const meta = { kind: "subscription", user_id: user.id, plan: body.plan, price_type: priceType };

  const requestId = newRequestId();
  const origin = appOrigin();
  try {
    const customer = await resolveStripeCustomer(user.id, user.email ?? null);
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(priceEUR * 100),
            recurring: { interval: "month" },
            product_data: { name: `Urivo ${plan.name}` },
          },
        },
      ],
      metadata: meta,
      subscription_data: { metadata: meta },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${origin}/dashboard/billing?upgraded=1`,
      cancel_url: `${origin}/dashboard/billing?checkout=cancelled`,
    });

    if (!session.url) throw new Error("NO_SESSION_URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    captureException(err, { requestId, route: "checkout", plan: body.plan });
    return NextResponse.json(
      { error: "CHECKOUT_FAILED", message: "We couldn't start checkout just now. Please try again." },
      { status: 502 },
    );
  }
}
