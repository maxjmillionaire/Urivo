import { cache } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { StorefrontRenderer } from "./storefront-renderer";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

interface Props {
  params: Promise<{ subdomain: string }>;
}

// Deduped per request: metadata, viewport and the page all resolve the same
// store from one query.
const loadStore = cache(async (subdomain: string) => {
  if (!SUBDOMAIN_PATTERN.test(subdomain)) return null;
  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("id, store_name, theme_config")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .single();
  return store ?? null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return { title: "Store not found" };
  const theme = parseTheme(store.theme_config);
  return {
    title: store.store_name,
    description: theme.tagline || store.store_name,
  };
}

// The storefront is the merchant's brand — the mobile browser chrome should
// match their canvas, not Urivo's navy. Overrides the root themeColor here.
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  const theme = store ? parseTheme(store.theme_config) : null;
  return { themeColor: theme?.background ?? "#ffffff" };
}

export default async function StorefrontPage({ params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();

  const supabase = await supabaseServer();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, price_eur, image_url")
    .eq("store_id", store.id)
    .order("position", { ascending: true });

  // New stores persist a full `designSystem`; older ones are adapted from their
  // legacy palette so nothing breaks while the generator is upgraded.
  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));

  return <StorefrontRenderer storeName={store.store_name} ds={ds} catalog={products ?? []} />;
}
