import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, isStripeConfigured } from "@/lib/commerce/stripe";
import { recordPaidOrder, type OrderLineInput } from "@/lib/commerce/orders";
import {
  linkSubscription,
  syncSubscription,
  cancelSubscription,
  grantMonthlyCredits,
  grantCreditPack,
  planFromSubscription,
  resolveUserForSubscription,
  sendRenewalReceipt,
} from "@/lib/billing/subscription";
import { captureException } from "@/lib/monitoring";
import { newRequestId, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Stripe webhook — the single, signature-verified entry point for everything
 * money-related. It handles two distinct payment surfaces:
 *
 *  1. STOREFRONT orders (Stripe Connect direct charges). These arrive with
 *     `event.account` set — the charge lived on the merchant's connected
 *     account. Orders are created idempotently (recordPaidOrder claims the
 *     event id) so Stripe retries can't duplicate an order.
 *
 *  2. PLATFORM billing (Urivo's own account): subscriptions and one-time credit
 *     packs. These have no `event.account`. Every effect here is individually
 *     idempotent — credit grants key off a stable ledger reason, and profile
 *     state writes are absolute — so retries are safe without claiming the event.
 *
 * The raw body is verified against STRIPE_WEBHOOK_SECRET before anything is
 * trusted.
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
    return NextResponse.json(
      { error: "INVALID_SIGNATURE", message: err instanceof Error ? err.message : "bad signature" },
      { status: 400 },
    );
  }

  const requestId = newRequestId();
  try {
    if (event.account) {
      // Connected-account event → a storefront order.
      await handleConnectEvent(event);
    } else {
      // Platform-account event → subscription or credit pack.
      await handlePlatformEvent(event);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    captureException(err, { requestId, route: "stripe-webhook", eventType: event.type });
    // 500 so Stripe retries — every handler is idempotent.
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// Storefront (Connect) orders — unchanged behaviour.
// ------------------------------------------------------------------

async function handleConnectEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "paid" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfilOrder(event, session);
    }
  }
}

async function fulfilOrder(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const storeId = session.metadata?.store_id;
  if (!storeId) return; // not a storefront order we created

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
    eventType: event.type,
    storeId,
    session,
    lines,
  });
}

// ------------------------------------------------------------------
// Platform billing — subscriptions + credit packs.
// ------------------------------------------------------------------

/** Coerce a Stripe field that may be an id string or an expanded object. */
function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

async function handlePlatformEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      await handlePlatformCheckout(event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "invoice.paid": {
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    }
    case "customer.subscription.updated": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      await cancelSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      // Everything else (payment_intent.*, charge.*, etc.) is informational here.
      break;
  }
}

async function handlePlatformCheckout(session: Stripe.Checkout.Session) {
  const kind = session.metadata?.kind;
  const userId = session.metadata?.user_id ?? session.client_reference_id ?? null;

  if (kind === "subscription") {
    // Activate the plan immediately (credits follow via invoice.paid).
    const subId = idOf(session.subscription);
    if (!subId || !userId) return;
    const sub = await stripe().subscriptions.retrieve(subId);
    await linkSubscription(userId, sub);
    return;
  }

  if (kind === "credit_pack") {
    // Only grant once the money is actually in.
    if (session.payment_status !== "paid") return;
    const packId = session.metadata?.pack;
    if (!packId || !userId) return;
    await grantCreditPack(userId, packId, session.id);
    return;
  }
}

/** The subscription an invoice belongs to (current API: under invoice.parent). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return; // not a subscription invoice

  const sub = await stripe().subscriptions.retrieve(subId);
  const userId = await resolveUserForSubscription(sub);
  if (!userId) {
    logger.info("invoice.paid for unknown user", { invoice: invoice.id, subscription: subId });
    return;
  }

  // Keep profile state fresh (plan/status/period), then grant the period's
  // credits keyed by the invoice id — first month and every renewal, once each.
  await syncSubscription(sub);
  await grantMonthlyCredits(userId, planFromSubscription(sub), invoice.id ?? subId);

  // A light receipt for genuine renewals only (the welcome covers the first).
  if (invoice.billing_reason === "subscription_cycle") {
    const amount = (invoice.amount_paid / 100).toFixed(invoice.amount_paid % 100 === 0 ? 0 : 2);
    const currency = (invoice.currency ?? "eur").toUpperCase();
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
    await sendRenewalReceipt(userId, `${symbol}${amount}`);
  }
}
