import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/*
 * Creator payouts — settling what the referral system says you owe.
 *
 * 0012 could record that a commission was owed; nothing could answer "what do
 * I owe this creator" or record the transfer. A payout is one real transfer
 * settling every currently-owed commission for one creator, computed inside
 * the database from a locked set so two clicks can never pay twice.
 */

export interface CreatorPayoutSummary {
  creatorId: string;
  creatorName: string;
  creatorCode: string;
  /** Commissions earned and not yet transferred. */
  owedCount: number;
  owedEur: number;
  /** Lifetime settled. */
  paidEur: number;
  lastPaidAt: string | null;
}

export interface PayoutResult {
  payoutId: string;
  amountEur: number;
  referralCount: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** What is owed to every creator right now, largest debt first. */
export async function getPayoutSummary(): Promise<CreatorPayoutSummary[]> {
  const { data, error } = await supabaseAdmin().rpc("creator_payout_summary");
  if (error) {
    logger.warn("creator_payout_summary failed", { error: error.message });
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    creatorId: String(r.creator_id),
    creatorName: String(r.creator_name ?? ""),
    creatorCode: String(r.creator_code ?? ""),
    owedCount: num(r.owed_count),
    owedEur: num(r.owed_eur),
    paidEur: num(r.paid_eur),
    lastPaidAt: r.last_paid_at ? String(r.last_paid_at) : null,
  }));
}

export class NothingOwedError extends Error {
  constructor() {
    super("NOTHING_OWED");
    this.name = "NothingOwedError";
  }
}

/**
 * Settle everything currently owed to one creator. The amount is computed in
 * the database from the locked set of owed commissions — never from a number
 * the caller supplies — so the UI cannot cause an over-payment.
 */
export async function payOutCreator(
  creatorId: string,
  details: { method?: string; reference?: string; note?: string } = {},
): Promise<PayoutResult> {
  const { data, error } = await supabaseAdmin().rpc("pay_out_creator", {
    p_creator_id: creatorId,
    p_method: details.method ?? null,
    p_reference: details.reference ?? null,
    p_note: details.note ?? null,
  });
  if (error) {
    if ((error.message || "").includes("NOTHING_OWED")) throw new NothingOwedError();
    throw new Error(`Payout failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  const result = {
    payoutId: String(row.payout_id),
    amountEur: num(row.amount_eur),
    referralCount: num(row.referral_count),
  };
  logger.info("creator payout recorded", { creatorId, ...result });
  return result;
}

export interface PayoutRecord {
  id: string;
  creatorName: string;
  amountEur: number;
  referralCount: number;
  method: string | null;
  reference: string | null;
  paidAt: string;
}

/** Payout history — the audit trail for what has actually been transferred. */
export async function getPayoutHistory(limit = 20): Promise<PayoutRecord[]> {
  const { data } = await supabaseAdmin()
    .from("creator_payouts")
    .select("id, amount_eur, referral_count, method, reference, paid_at, creators(name)")
    .order("paid_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    creatorName: String((r.creators as { name?: string } | null)?.name ?? "—"),
    amountEur: num(r.amount_eur),
    referralCount: num(r.referral_count),
    method: (r.method as string) ?? null,
    reference: (r.reference as string) ?? null,
    paidAt: String(r.paid_at),
  }));
}
