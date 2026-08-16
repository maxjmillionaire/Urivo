import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { ProductView } from "./product-view";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ subdomain: string; id: string }>;
}

const load = cache(async (subdomain: string, id: string) => {
  if (!SUBDOMAIN_PATTERN.test(subdomain) || !UUID.test(id)) return null;
  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("id, store_name, theme_config, currency")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .maybeSingle();
  if (!store) return null;
  const { data: product } = await supabase
    .from("products")
    .select("id, title, description, price_eur, image_url, inventory_count")
    .eq("id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!product) return null;

  // The rest of the collection — a real, honest cross-sell ("More from …").
  const { data: related } = await supabase
    .from("products")
    .select("id, title, price_eur, image_url")
    .eq("store_id", store.id)
    .neq("id", id)
    .order("position", { ascending: true })
    .limit(4);

  return { store, product, related: related ?? [] };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain, id } = await params;
  const data = await load(subdomain, id);
  if (!data) return { title: "Product not found" };
  return {
    title: `${data.product.title} — ${data.store.store_name}`,
    description: data.product.description ?? undefined,
    ...(data.product.image_url ? { openGraph: { images: [data.product.image_url] } } : {}),
  };
}

export default async function ProductPage({ params }: Props) {
  const { subdomain, id } = await params;
  const data = await load(subdomain, id);
  if (!data) notFound();
  const { store, product, related } = data;

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));
  const currency = (store as { currency?: string }).currency ?? "eur";
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  const storeBase = rootDomain.startsWith("localhost") ? `/store/${subdomain}` : "";

  return (
    <ProductView
      storeName={store.store_name}
      subdomain={subdomain}
      storeBase={storeBase}
      currency={currency}
      ds={ds}
      product={product}
      related={related}
    />
  );
}
