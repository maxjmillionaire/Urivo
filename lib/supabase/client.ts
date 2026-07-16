import { createBrowserClient } from "@supabase/ssr";

/*
 * Browser-side Supabase client (anon key only — RLS enforces tenancy).
 * Created lazily inside event handlers, never at module scope, so pages
 * prerender cleanly before the environment is configured.
 */
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createBrowserClient(url, key);
}
