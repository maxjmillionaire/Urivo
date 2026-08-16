import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { LearnedSignals, SupplierProviderId } from "./types";

/*
 * Merchant Intelligence — read/write over the anonymised, platform-wide outcome
 * aggregate (migration 0015). Writes are best-effort events; reads turn the
 * aggregate into LearnedSignals that the Urivo Score blends in.
 *
 * Discipline: learned signals are only surfaced once there's a statistically
 * meaningful sample, so a handful of early data points never distorts a score.
 */

export type OutcomeEvent = "import" | "impression" | "order" | "refund" | "removal" | "repeat";

// Below these, we don't trust the aggregate enough to influence the score.
const MIN_ORDERS = 10;
const MIN_IMPORTS = 20;

export interface RecordOutcomeInput {
  provider: SupplierProviderId;
  externalProductId: string;
  event: OutcomeEvent;
  category?: string | null;
  niche?: string | null;
  valueCents?: number;
  storeId?: string | null;
}

/**
 * Record one anonymised outcome (import/order/refund/removal/repeat). Atomic —
 * appends the event and rolls it into the per-product aggregate. Best-effort:
 * intelligence must never break a user action, so failures are swallowed.
 */
export async function recordProductOutcome(input: RecordOutcomeInput): Promise<void> {
  try {
    await supabaseAdmin().rpc("record_product_outcome", {
      p_provider: input.provider,
      p_external_id: input.externalProductId,
      p_category: input.category ?? null,
      p_niche: input.niche ?? null,
      p_event: input.event,
      p_value_cents: input.valueCents ?? 0,
      p_store_id: input.storeId ?? null,
    });
  } catch {
    /* intelligence is never allowed to affect the user action */
  }
}

interface IntelRow {
  external_product_id: string;
  imports: number;
  orders: number;
  refunds: number;
  removals: number;
  repeat_orders: number;
}

function toLearned(r: IntelRow): LearnedSignals | null {
  const orders = Number(r.orders);
  const imports = Number(r.imports);
  if (orders < MIN_ORDERS && imports < MIN_IMPORTS) return null; // not enough data yet

  return {
    sampleSize: orders, // drives how much the score trusts learned data
    refundRatePct: orders > 0 ? (Number(r.refunds) / orders) * 100 : null,
    repeatPurchaseRatePct: orders > 0 ? (Number(r.repeat_orders) / orders) * 100 : null,
    removalRatePct: imports > 0 ? (Number(r.removals) / imports) * 100 : null,
    // Relative indices (conversion vs platform avg, AOV) need global baselines —
    // added once there's a platform-wide rollup. Null = neutral in the score.
    conversionIndex: null,
    aovIndex: null,
    nicheFitScore: null,
  };
}

/** Learned signals for one product, or null if not yet meaningful. */
export async function learnedSignalsFor(
  provider: SupplierProviderId,
  externalProductId: string,
): Promise<LearnedSignals | null> {
  const { data } = await supabaseAdmin()
    .from("product_intelligence")
    .select("external_product_id, imports, orders, refunds, removals, repeat_orders")
    .eq("provider", provider)
    .eq("external_product_id", externalProductId)
    .maybeSingle();
  return data ? toLearned(data as IntelRow) : null;
}

/** Batch variant for scoring a whole search page in one query. */
export async function learnedSignalsForMany(
  provider: SupplierProviderId,
  externalProductIds: string[],
): Promise<Map<string, LearnedSignals>> {
  const out = new Map<string, LearnedSignals>();
  if (externalProductIds.length === 0) return out;
  const { data } = await supabaseAdmin()
    .from("product_intelligence")
    .select("external_product_id, imports, orders, refunds, removals, repeat_orders")
    .eq("provider", provider)
    .in("external_product_id", externalProductIds);
  for (const row of (data ?? []) as IntelRow[]) {
    const learned = toLearned(row);
    if (learned) out.set(row.external_product_id, learned);
  }
  return out;
}
