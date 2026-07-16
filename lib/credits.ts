import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Credit business logic — one place, server-authoritative (spec 6.2 §14).
 * Balance is derived from the append-only ledger via the credit_balance
 * function, executed with the service role (the function is revoked from
 * client roles in migration 0002).
 */

export const STORE_GENERATION_COST = 10;

export async function getCreditBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("credit_balance", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`Failed to read credit balance: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}
