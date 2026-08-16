import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, isStripeConfigured } from "@/lib/commerce/stripe";
import { recordPaidOrder, type OrderLineInput } from "@/lib/commerce/orders";
import { notify } from "@/lib/notifications/service";
import { sendEmail } from "@/lib/email/service";
import { newOrderEmail } from "@/lib/email/templates";
import {
  linkSubscription,
  syncSubscription,
  cancelSubscription,
  grantMonthlyCredits,
  grantCreditPack,
  planFromSubscription,
  resolveUserForSubscription,
  sendRenewalReceipt,
  subscriptionPeriodEnd,
} from "@/lib/billing/subscription";
import { applyAccountUpdate } from "@/lib/billing/connect";
import { notifyPayoutsReady, notifyPayoutsRestricted } from "@/lib/notifications/events";
import { recordRevenue } from "@/lib/finance/revenue";
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
    return;
  }

  // The merchant's payout account changed — Stripe can enable OR disable a
  // merchant at any time, so this is what keeps a live store honest about
  // whether it can still take money.
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const before = await connectStatusForAccount(account.id);
    await applyAccountUpdate(account);

    const nowEnabled = account.charges_enabled === true;
    if (before !== null && before !== nowEnabled) {
      const userId = await userIdForAccount(account.id);
      if (userId) {
        await (nowEnabled ? notifyPayoutsReady(userId) : notifyPayoutsRestricted(userId));
      }
    }
  }
}

/** The user behind a connected account, or null if we don't know it. */
async function userIdForAccount(accountId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  return data?.id ?? null;
}

/** Charges-enabled as we currently have it mirrored, or null if unknown. */
async function connectStatusForAccount(accountId: string): Promise<boolean | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_charges_enabled")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (!data) return null;
  return data.stripe_charges_enabled === true;
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

  const orderId = await recordPaidOrder(supabaseAdmin(), {
    eventId: event.id,
    eventType: event.type,
    storeId,
    session,
    lines,
  });

  // A genuinely new order (not a replayed webhook) → tell the merchant.
  if (orderId) await notifyMerchantOfOrder(storeId, session);
}

/**
 * The "cha-ching": notify the store owner of a new sale — in-app and by email —
 * and celebrate the very first one. Best-effort; never affects order recording.
 */
async function notifyMerchantOfOrder(storeId: string, session: Stripe.Checkout.Session) {
  try {
    const admin = supabaseAdmin();
    const { data: store } = await admin
      .from("stores")
      .select("user_id, store_name")
      .eq("id", storeId)
      .maybeSingle();
    if (!store?.user_id) return;

    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId);
    const isFirst = (count ?? 0) <= 1;

    const cents = session.amount_total ?? 0;
    const currency = (session.currency ?? "eur").toUpperCase();
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
    const amount = `${symbol}${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

    await notify(store.user_id, {
      kind: isFirst ? "first_sale" : "order",
      title: isFirst ? `Your first sale on ${store.store_name}` : `New order — ${amount}`,
      body: isFirst
        ? `${store.store_name} just made its first sale (${amount}).`
        : `${store.store_name} received an order for ${amount}.`,
      href: `/dashboard/stores/${storeId}/orders`,
      severity: "success",
      metadata: { storeId, amountCents: cents },
    });

    const { data: owner } = await admin.from("profiles").select("email").eq("id", store.user_id).maybeSingle();
    if (owner?.email) {
      await sendEmail({ to: owner.email, email: newOrderEmail(store.store_name, amount, isFirst) });
    }
  } catch (err) {
    logger.warn("notifyMerchantOfOrder failed", { storeId, err: err instanceof Error ? err.message : String(err) });
  }
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
      await handlePlatformCheckout(event, event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "invoice.paid": {
      await handleInvoicePaid(event, event.data.object as Stripe.Invoice);
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
    /*
     * A refund is revenue leaving. Recorded as a negative amount so the
     * month's total is a plain sum — a figure that has to remember to subtract
     * something eventually forgets.
     */
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await recordRevenue({
        stripeEventId: event.id,
        kind: "refund",
        amountCents: -Math.abs(charge.amount_refunded ?? 0),
        currency: charge.currency ?? "eur",
        stripeObjectId: charge.id,
        occurredAt: new Date(event.created * 1000),
      });
      break;
    }
    default:
      // Everything else (payment_intent.*, etc.) is informational here.
      break;
  }
}

async function handlePlatformCheckout(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const kind = session.metadata?.kind;
  const userId = session.metadata?.user_id ?? session.client_reference_id ?? null;

  if (kind === "subscription") {
    // Activate the plan immediately (credits follow via invoice.paid).
    const subId = idOf(session.subscription);
    if (!subId || !userId) return;
    const sub = await stripe().subscriptions.retrieve(subId);
    await linkSubscription(userId, sub);
    /*
     * Deliberately NOT recorded as revenue here. Every subscription checkout
     * also produces an invoice.paid carrying the same money, and recording
     * both would double the first month of every customer we ever sign — the
     * one month a founder looks at hardest.
     */
    return;
  }

  if (kind === "credit_pack") {
    // Only grant once the money is actually in.
    if (session.payment_status !== "paid") return;
    const packId = session.metadata?.pack;
    if (!packId || !userId) return;
    await grantCreditPack(userId, packId, session.id);
    // A pack produces no invoice, so this is its only record.
    await recordRevenue({
      stripeEventId: event.id,
      kind: "credit_pack",
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "eur",
      userId,
      pack: packId,
      stripeObjectId: session.id,
      occurredAt: new Date(event.created * 1000),
    });
    return;
  }
}

/** The subscription an invoice belongs to (current API: under invoice.parent). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

async function handleInvoicePaid(event: Stripe.Event, invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return; // not a subscription invoice

  const sub = await stripe().subscriptions.retrieve(subId);
  const userId = await resolveUserForSubscription(sub);

  /*
   * Recorded before the user lookup can turn us away. Money that arrived is
   * money that arrived; an invoice we cannot attribute to a profile still
   * belongs in the total, or revenue silently under-reports exactly when
   * something else has gone wrong.
   */
  await recordRevenue({
    stripeEventId: event.id,
    kind: "subscription",
    amountCents: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? "eur",
    userId,
    plan: planFromSubscription(sub),
    stripeObjectId: invoice.id ?? subId,
    occurredAt: new Date(event.created * 1000),
  });

  if (!userId) {
    logger.info("invoice.paid for unknown user", { invoice: invoice.id, subscription: subId });
    return;
  }

  // Keep profile state fresh (plan/status/period), then grant the period's
  // credits keyed by the invoice id — first month and every renewal, once each.
  // Plan credits expire at the end of this billing period (use-it-or-lose-it).
  await syncSubscription(sub);
  await grantMonthlyCredits(
    userId,
    planFromSubscription(sub),
    invoice.id ?? subId,
    subscriptionPeriodEnd(sub),
  );

  // A light receipt for genuine renewals only (the welcome covers the first).
  if (invoice.billing_reason === "subscription_cycle") {
    const amount = (invoice.amount_paid / 100).toFixed(invoice.amount_paid % 100 === 0 ? 0 : 2);
    const currency = (invoice.currency ?? "eur").toUpperCase();
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
    await sendRenewalReceipt(userId, `${symbol}${amount}`);
  }
}
