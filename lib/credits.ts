import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Credit business logic — one place, server-authoritative (spec 6.2 §14).
 * Balance is derived from the append-only ledger via the credit_balance
 * function, executed with the service role (the function is revoked from
 * client roles in migration 0002).
 */

export const STORE_GENERATION_COST = 10;

/** Thrown by spendCredits when the user can't afford an action. */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("INSUFFICIENT_CREDITS");
    this.name = "InsufficientCreditsError";
  }
}

/*
 * Spend credits for an AI action (server-authoritative, via the spend_credits
 * RPC). Deducts atomically under a row lock, returns the new balance, and throws
 * InsufficientCreditsError if the caller can't afford it. Charge AFTER the work
 * succeeds so a failed action never costs the user (spec 6.2 §19).
 */
export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
  source = "ai",
): Promise<number> {
  if (amount <= 0) return getCreditBalance(userId);
  const { data, error } = await supabaseAdmin().rpc("spend_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_source: source,
  });
  if (error) {
    if ((error.message || "").includes("INSUFFICIENT_CREDITS")) throw new InsufficientCreditsError();
    throw new Error(`Failed to spend credits: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

export async function getCreditBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("credit_balance", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Failed to read credit balance: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
}

export async function getCreditLedger(
  userId: string,
  limit = 20,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabaseAdmin()
    .from("credit_ledger")
    .select("id, delta, reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
