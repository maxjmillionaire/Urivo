import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";
import { resolveStripeCustomer } from "@/lib/billing/customer";
import { getCreditPack } from "@/lib/credit-packs";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Credit-pack purchase — a one-time Stripe Checkout Session (payment mode) that
 * tops up the buyer's credit balance. Pricing comes from lib/credit-packs (the
 * single source of truth) as inline price_data. Credits are granted by the
 * webhook on checkout.session.completed (grantCreditPack, idempotent per
 * session) — never here.
 */

const BodySchema = z.object({ pack: z.enum(["boost", "studio", "scale"]) });

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
    return NextResponse.json({ error: "INVALID_INPUT", message: "Unknown credit pack." }, { status: 400 });
  }

  const pack = getCreditPack(body.pack);
  if (!pack) {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Unknown credit pack." }, { status: 400 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "BILLING_UNAVAILABLE", message: "Credit packs open at launch. Thanks for your interest!" },
      { status: 503 },
    );
  }

  const requestId = newRequestId();
  const origin = appOrigin();
  try {
    const customer = await resolveStripeCustomer(user.id, user.email ?? null);
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(pack.priceEUR * 100),
            product_data: { name: `Urivo ${pack.name} — ${pack.credits} credits` },
          },
        },
      ],
      metadata: {
        kind: "credit_pack",
        user_id: user.id,
        pack: pack.id,
        credits: String(pack.credits),
      },
      // A pack is a top-up, not a payment against a shipped good — no address.
      success_url: `${origin}/dashboard/billing?credits=1`,
      cancel_url: `${origin}/dashboard/billing?checkout=cancelled`,
    });

    if (!session.url) throw new Error("NO_SESSION_URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    captureException(err, { requestId, route: "credits-checkout", pack: body.pack });
    return NextResponse.json(
      { error: "CHECKOUT_FAILED", message: "We couldn't start checkout just now. Please try again." },
      { status: 502 },
    );
  }
}
