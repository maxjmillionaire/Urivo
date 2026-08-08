import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { captureException } from "@/lib/monitoring";

/*
 * Order persistence. Orders are created ONLY from a verified Stripe webhook
 * (checkout.session.completed) using the service role — never from the client.
 * The `stripe_webhook_events` table (migration 0001) gives idempotency so a
 * replayed webhook can't create a duplicate order.
 */

export interface OrderLineInput {
  productId: string | null;
  title: string;
  unitAmount: number;
  quantity: number;
}

/**
 * Idempotently record a paid order from a completed Checkout Session. Returns
 * the order id, or null if this event was already processed.
 */
export async function recordPaidOrder(
  admin: SupabaseClient,
  params: {
    eventId: string;
    eventType: string;
    storeId: string;
    session: Stripe.Checkout.Session;
    lines: OrderLineInput[];
  },
): Promise<string | null> {
  // Idempotency: claim the event first. A duplicate insert (same event_id PK)
  // means we've already handled this event. The table's columns are event_id
  // (PK) + event_type (NOT NULL) — see migration 0001.
  const { error: claimErr } = await admin
    .from("stripe_webhook_events")
    .insert({ event_id: params.eventId, event_type: params.eventType, processing_status: "processed" });
  if (claimErr) {
    // Unique violation → already processed.
    return null;
  }

  const s = params.session;
  const subtotal = params.lines.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .insert({
      store_id: params.storeId,
      stripe_session_id: s.id,
      stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
      customer_email: s.customer_details?.email ?? s.customer_email ?? null,
      customer_name: s.customer_details?.name ?? null,
      amount_subtotal: subtotal,
      amount_total: s.amount_total ?? subtotal,
      currency: (s.currency ?? "eur").toLowerCase(),
      status: "paid",
    })
    .select("id")
    .single();

  if (orderErr || !order) throw orderErr ?? new Error("ORDER_INSERT_FAILED");

  /*
   * Attribute the sale to the ad that earned it.
   *
   * The session id rode along in the Stripe metadata because the webhook has
   * no browser context. The RPC finds the FIRST visit in that session which
   * carried a creative — first touch, so the ad that introduced the brand gets
   * the sale rather than whatever retargeting ad ran last.
   *
   * Attribution may fail without breaking commerce, but it must never fail
   * invisibly. The previous form — .then(() => undefined, () => undefined) —
   * discarded a rejection AND never inspected the `error` that supabase-js
   * returns in the result object, which is where a real failure actually
   * arrives. It hid a 42804 for an entire release: every unattributed order
   * raised, the row kept its default, and the default read as a confident
   * answer.
   *
   * The order is already inserted at this point, so nothing here can lose a
   * sale. What changes is that the row stays 'unknown' — not 'none' — and the
   * failure reaches monitoring.
   */
  const sid = typeof s.metadata?.sid === "string" ? s.metadata.sid : null;
  if (sid) {
    try {
      const { error } = await admin.rpc("attribute_order", {
        p_order_id: order.id,
        p_session_hash: sid,
      });
      if (error) {
        captureException(new Error(`attribute_order failed: ${error.message}`), {
          orderId: order.id,
          storeId: params.storeId,
          route: "orders:attribute",
        });
      }
    } catch (err) {
      captureException(err, { orderId: order.id, storeId: params.storeId, route: "orders:attribute" });
    }
  } else {
    /*
     * No commerce session on the Stripe metadata. Left at 'unknown' rather
     * than decided: the checkout may predate the cookie, or the metadata may
     * have been dropped. Claiming "this sale came from no ad" would be an
     * answer we did not earn.
     */
    captureException(new Error("attribute_order skipped: no session on checkout metadata"), {
      orderId: order.id,
      storeId: params.storeId,
      route: "orders:attribute",
    });
  }

  if (params.lines.length > 0) {
    const { error: itemsErr } = await admin.from("order_items").insert(
      params.lines.map((l) => ({
        order_id: order.id,
        product_id: l.productId,
        title: l.title,
        unit_amount: l.unitAmount,
        quantity: l.quantity,
        line_total: l.unitAmount * l.quantity,
      })),
    );
    if (itemsErr) throw itemsErr;
  }

  return order.id;
}

export interface MerchantOrder {
  id: string;
  customerEmail: string | null;
  customerName: string | null;
  amountTotal: number;
  currency: string;
  status: string;
  createdAt: string;
  itemCount: number;
}

/** List a store's orders for the merchant dashboard (RLS enforces ownership). */
export async function listStoreOrders(
  supabase: SupabaseClient,
  storeId: string,
  limit = 50,
): Promise<MerchantOrder[]> {
  const { data } = await supabase
    .from("orders")
    .select("id, customer_email, customer_name, amount_total, currency, status, created_at, order_items(quantity)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((o) => {
    const items = (o.order_items ?? []) as { quantity: number }[];
    return {
      id: o.id as string,
      customerEmail: (o.customer_email as string) ?? null,
      customerName: (o.customer_name as string) ?? null,
      amountTotal: o.amount_total as number,
      currency: o.currency as string,
      status: o.status as string,
      createdAt: o.created_at as string,
      itemCount: items.reduce((s, i) => s + (i.quantity ?? 0), 0),
    };
  });
}
