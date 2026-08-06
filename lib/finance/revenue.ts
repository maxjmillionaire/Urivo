import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/*
 * Platform revenue — every euro Urivo actually collects.
 *
 * Before this existed, monthly revenue was inferred: count profiles by plan,
 * multiply by the list price. That silently assumes nobody holds a founding
 * price, nobody bought a credit pack, nobody was refunded, and every
 * subscription actually collected. Gross margin built on it is an estimate
 * wearing the clothes of a measurement, and it drifts furthest from reality in
 * exactly the month a founder most needs it — the first one.
 *
 * Written from Stripe's own numbers at the moment money moves, keyed by the
 * Stripe EVENT id. Stripe retries webhooks by design; without that key a retry
 * would add the same euros twice and every figure downstream would inherit the
 * error with no way to notice.
 */

export type RevenueKind = "subscription" | "credit_pack" | "refund";

export interface RevenueEvent {
  /** Stripe's event id — the idempotency key. Required. */
  stripeEventId: string;
  kind: RevenueKind;
  /** Minor units, signed as Stripe reports them. Refunds must arrive negative. */
  amountCents: number;
  currency?: string;
  userId?: string | null;
  plan?: string | null;
  pack?: string | null;
  stripeObjectId?: string | null;
  occurredAt?: Date;
}

/**
 * Record one revenue event. Best-effort and never throws into the webhook: a
 * bookkeeping failure must not cause Stripe to retry an event that already
 * granted a plan or credits. A missing row understates revenue, which is
 * recoverable; a retried grant is not.
 */
export async function recordRevenue(event: RevenueEvent): Promise<void> {
  if (!event.stripeEventId || !Number.isFinite(event.amountCents)) return;
  // Zero-amount events (trials, 100% coupons) are real but carry no money;
  // storing them would inflate the event count without moving any total.
  if (event.amountCents === 0) return;

  try {
    const { error } = await supabaseAdmin()
      .from("platform_revenue")
      .insert({
        stripe_event_id: event.stripeEventId,
        kind: event.kind,
        amount_cents: Math.round(event.amountCents),
        currency: (event.currency ?? "eur").toLowerCase(),
        user_id: event.userId ?? null,
        plan: event.plan ?? null,
        pack: event.pack ?? null,
        stripe_object_id: event.stripeObjectId ?? null,
        occurred_at: (event.occurredAt ?? new Date()).toISOString(),
      });

    // 23505 is the unique violation on stripe_event_id — a Stripe retry landing
    // on an event already recorded. That is the mechanism working, not a fault.
    if (error && error.code !== "23505") {
      logger.warn("Revenue not recorded", {
        stripeEventId: event.stripeEventId,
        kind: event.kind,
        message: error.message,
      });
    }
  } catch (err) {
    logger.warn("Revenue not recorded", {
      stripeEventId: event.stripeEventId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface RevenueTotals {
  totalEur: number;
  subscriptionEur: number;
  packEur: number;
  refundEur: number;
  events: number;
  /** Charges in another currency, excluded from the totals rather than guessed. */
  nonEurEvents: number;
}

const ZERO: RevenueTotals = {
  totalEur: 0,
  subscriptionEur: 0,
  packEur: 0,
  refundEur: 0,
  events: 0,
  nonEurEvents: 0,
};

/** Measured revenue for a period. Zeroes on any failure — never a made-up number. */
export async function getRevenue(since: Date): Promise<RevenueTotals> {
  try {
    const { data, error } = await supabaseAdmin().rpc("finance_revenue", {
      p_since: since.toISOString(),
    });
    if (error || !data) return ZERO;
    const r = data as Record<string, number>;
    const eur = (cents: unknown) => Number(cents ?? 0) / 100;
    return {
      totalEur: eur(r.total_cents),
      subscriptionEur: eur(r.subscription_cents),
      packEur: eur(r.pack_cents),
      refundEur: eur(r.refund_cents),
      events: Number(r.events ?? 0),
      nonEurEvents: Number(r.non_eur_events ?? 0),
    };
  } catch {
    return ZERO;
  }
}

/** True once any revenue has ever been recorded — drives "measured" vs "modelled". */
export async function hasRecordedRevenue(): Promise<boolean> {
  try {
    const { count, error } = await supabaseAdmin()
      .from("platform_revenue")
      .select("id", { count: "exact", head: true })
      .limit(1);
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
