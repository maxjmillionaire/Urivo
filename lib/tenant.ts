import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

/*
 * Tenant-isolation helper (spec 6.1 §5: always verify ownership first,
 * never trust ids coming from the frontend).
 *
 * Returns the authenticated user and confirms they own the given store,
 * or an error tag the route maps to an HTTP status.
 */

export type OwnershipResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "UNAUTHORIZED" | "NOT_FOUND" };

export async function requireStoreOwner(storeId: string): Promise<OwnershipResult> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "UNAUTHORIZED" };

  const { data: store } = await supabase
    .from("stores")
    .select("id, user_id")
    .eq("id", storeId)
    .maybeSingle();

  // Not found and not-owned are indistinguishable to the caller — never
  // reveal that a foreign store exists.
  if (!store || store.user_id !== user.id) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  return { ok: true, userId: user.id };
}
