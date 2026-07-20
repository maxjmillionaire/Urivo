import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlan, type PlanConfig } from "@/lib/plans";

/*
 * Server-side plan resolution. Feature gating is enforced HERE against the real
 * profile row — never trusted from the client (spec 6.1). Read the plan once and
 * ask the PlanConfig what the tier is allowed to do.
 */

/** Resolve a user's plan config from their profile. Defaults to Free on any miss. */
export async function getPlanForUser(
  userId: string,
  client?: SupabaseClient,
): Promise<PlanConfig> {
  const db = client ?? supabaseAdmin();
  const { data } = await db.from("profiles").select("plan").eq("id", userId).single();
  return getPlan(data?.plan ?? "free");
}
