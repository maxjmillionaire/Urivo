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
  void maybeExpireComps();
  return getPlan(data?.plan ?? "free");
}

/*
 * Comped access expiry, driven by traffic rather than by a scheduler.
 *
 * Granted access writes the real plan onto the profile so that every gate,
 * dashboard and billing screen keeps working without knowing comps exist. The
 * cost of that choice is that something has to put the plan back.
 *
 * A cron job would be the obvious answer and the wrong one here: it is another
 * thing to configure on a deadline, and if it is not configured — or the secret
 * is wrong, or the schedule never fires — nothing complains and every tester
 * silently keeps Pro forever. Expiry that depends on someone remembering is not
 * expiry.
 *
 * So the sweep rides along with ordinary traffic: at most once every ten
 * minutes per instance, fire-and-forget, never blocking the request that
 * triggered it. The database statement is indexed on the handful of comped rows
 * and does nothing at all when none have expired. If the product is idle,
 * nobody's access matters; the moment anyone uses it, the sweep has run.
 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = 0;

export function maybeExpireComps(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  // Claim the slot before awaiting, so concurrent requests do not all sweep.
  lastSweep = now;
  void (async () => {
    try {
      await supabaseAdmin().rpc("expire_comped_access");
    } catch {
      /*
       * Deliberately silent, and so is the error the call resolves with rather
       * than throws. A failed sweep is retried in ten minutes and the only
       * consequence is that a comp outlives its expiry by a few minutes — not a
       * reason to fail the request that happened to trigger it. The likeliest
       * cause is simply that migration 0035 has not been applied yet, which
       * /api/health?deep=1 reports directly.
       */
    }
  })();
}
