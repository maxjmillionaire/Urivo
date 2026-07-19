import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, isStripeConfigured } from "@/lib/commerce/stripe";
import { recordPaidOrder, type OrderLineInput } from "@/lib/commerce/orders";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Stripe webhook — the ONLY place orders are created. The raw body is verified
 * against STRIPE_WEBHOOK_SECRET before anything is trusted. Storefront charges
 * are direct charges on the merchant's connected account, so the event carries
 * `account`; line items are read from that same connected account.
 *
 * Order creation is idempotent (recordPaidOrder claims the event id), so Stripe
 * retries can't duplicate an order.
 */

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "NO_SIGNATURE" }, { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    // Signature verification failed — reject.
    return NextResponse.json(
      { error: "INVALID_SIGNATURE", message: err instanceof Error ? err.message : "bad signature" },
      { status: 400 },
    );
  }

  const requestId = newRequestId();
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid" || event.type === "checkout.session.async_payment_succeeded") {
        await fulfil(event, session);
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    captureException(err, { requestId, route: "stripe-webhook", eventType: event.type });
    // 500 so Stripe retries — but idempotency guards against double-processing.
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 500 });
  }
}

async function fulfil(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const storeId = session.metadata?.store_id;
  if (!storeId) return; // not a storefront order we created

  // Rebuild the line snapshot: product ids from our metadata, names/amounts
  // from the connected account's line items (what was actually charged).
  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(session.metadata?.cart ?? "[]") as [string, number][];
    productIds = parsed.map((p) => p[0]);
  } catch {
    productIds = [];
  }

  const connectedAccount = event.account;
  let lines: OrderLineInput[] = [];
  try {
    const items = await stripe().checkout.sessions.listLineItems(
      session.id,
      { limit: 100 },
      connectedAccount ? { stripeAccount: connectedAccount } : undefined,
    );
    lines = items.data.map((li, i) => ({
      productId: productIds[i] ?? null,
      title: li.description ?? "Item",
      unitAmount: li.price?.unit_amount ?? Math.round((li.amount_subtotal ?? 0) / (li.quantity ?? 1)),
      quantity: li.quantity ?? 1,
    }));
  } catch {
    lines = [];
  }

  await recordPaidOrder(supabaseAdmin(), {
    eventId: event.id,
    storeId,
    session,
    lines,
  });
}
