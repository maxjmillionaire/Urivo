import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Storefront read cache.
 *
 * Storefronts are the pages merchants pay to send traffic to. Every visit used
 * to re-query the catalogue and re-render from scratch, so every click on an ad
 * the merchant bought paid full database latency.
 *
 * Two rules make this safe rather than merely fast:
 *
 * 1. ONLY PUBLIC DATA IS CACHED. The page's own query runs under RLS so the
 *    owner can preview an unpublished store — caching that would risk serving
 *    one merchant's draft to the public. This reads through the admin client
 *    with an explicit `is_active = true`, so what enters the cache is exactly
 *    what any anonymous visitor may see. A draft falls through to the page's
 *    uncached, RLS-scoped path.
 *
 * 2. EVERY MUTATION BUSTS IT. Prices are the reason. A cached catalogue that
 *    outlived a price change would show €89 while checkout — which always
 *    re-reads the database — charges €99. So every route that writes a store or
 *    its products calls revalidateStore(), and the short TTL is a backstop
 *    against a path being missed, never the mechanism for freshness.
 */

const TTL_SECONDS = 300;

const tag = (subdomain: string) => `store:${subdomain.toLowerCase()}`;

export interface CachedStore {
  id: string;
  store_name: string;
  theme_config: unknown;
  currency: string | null;
  is_active: boolean;
}

export interface CachedProduct {
  id: string;
  title: string;
  description: string | null;
  price_eur: number;
  image_url: string | null;
  show_logo: boolean | null;
}

export interface CachedStorefront {
  store: CachedStore;
  products: CachedProduct[];
}

/**
 * The published storefront for a subdomain, or null when there is no LIVE store
 * there — which includes the owner-preview case, handled uncached by the caller.
 */
export function getPublishedStorefront(subdomain: string) {
  const key = subdomain.toLowerCase();
  return unstable_cache(
    async (): Promise<CachedStorefront | null> => {
      const admin = supabaseAdmin();
      const { data: store, error } = await admin
        .from("stores")
        .select("id, store_name, theme_config, currency, is_active")
        .eq("subdomain", key)
        .eq("is_active", true)
        .maybeSingle();
      // A failed read must not be cached as "this store does not exist".
      if (error) throw new Error(error.message);
      if (!store) return null;

      const { data: products } = await admin
        .from("products")
        .select("id, title, description, price_eur, image_url, show_logo")
        .eq("store_id", store.id)
        .order("position", { ascending: true });

      return { store: store as CachedStore, products: (products ?? []) as CachedProduct[] };
    },
    ["storefront", key],
    { tags: [tag(key)], revalidate: TTL_SECONDS },
  )();
}

/**
 * Drop a store's cached storefront. Call after ANY write to the store or its
 * products — a merchant who changes a price and still sees the old one on their
 * own live store will not trust the next thing they change either.
 *
 * Never throws: a cache miss is recoverable, a failed request is not.
 */
export function revalidateStore(subdomain: string | null | undefined): void {
  if (!subdomain) return;
  try {
    revalidateTag(tag(subdomain));
  } catch {
    /* outside a request scope (e.g. a background job) — the TTL still applies */
  }
}

/**
 * Same, for the many write paths that hold a store id rather than a subdomain.
 * Resolving it here keeps the call site to one line, which is the difference
 * between every mutation busting the cache and most of them doing it.
 */
export async function revalidateStoreById(storeId: string | null | undefined): Promise<void> {
  if (!storeId) return;
  try {
    const { data } = await supabaseAdmin()
      .from("stores")
      .select("subdomain")
      .eq("id", storeId)
      .maybeSingle();
    revalidateStore(data?.subdomain ?? null);
  } catch {
    /* see above — the TTL is the backstop */
  }
}
