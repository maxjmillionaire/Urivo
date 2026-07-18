import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import type { RailStore } from "./app-rail";

/*
 * The companion rail shows the merchant's active store on every screen. This
 * loads that preview once per request for any dashboard page.
 */
export async function loadRailStore(userId: string): Promise<RailStore | null> {
  const supabase = await supabaseServer();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, store_name, subdomain, is_active, theme_config, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (!stores || stores.length === 0) return null;
  const top = stores.find((s) => s.is_active) ?? stores[0];
  const theme = parseTheme(top.theme_config);
  const { data: products } = await supabase
    .from("products")
    .select("title, price_eur")
    .eq("store_id", top.id)
    .order("position", { ascending: true })
    .limit(4);

  return {
    name: top.store_name,
    subdomain: top.subdomain,
    tagline: theme.tagline,
    isLive: top.is_active,
    palette: { background: theme.background, structure: theme.structure, accent: theme.accent },
    products: (products ?? []).map((p) => ({ title: p.title, priceEUR: Number(p.price_eur) })),
  };
}
