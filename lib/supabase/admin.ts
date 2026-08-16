import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
 * Service-role Supabase client. SERVER ONLY — bypasses RLS.
 * Used for operations that must be server-authoritative (spec 6.1 §1):
 * atomic credit deduction, webhook processing, admin reads.
 * Never import this into a Client Component.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Admin Supabase client unavailable: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
