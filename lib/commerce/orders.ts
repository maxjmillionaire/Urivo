import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

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
    storeId: string;
    session: Stripe.Checkout.Session;
    lines: OrderLineInput[];
  },
): Promise<string | null> {
  // Idempotency: claim the event id first. A duplicate insert means we've
  // already handled this event.
  const { error: claimErr } = await admin
    .from("stripe_webhook_events")
    .insert({ id: params.eventId });
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
