import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { productJsonLd, jsonLdScript, storefrontUrl } from "@/lib/seo";
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
    // image_source carries per-image provenance (migration 0032) and is read by
    // the AI Act Art. 50 disclosure. Selecting it is not optional: a column left
    // out of the query arrives as undefined, which the disclosure rule reads as
    // "provenance unknown" — the safe direction, but it would make every store
    // disclose, including merchants who shot their own photographs.
    // One string literal on purpose: the Supabase client infers the row type
    // from the literal, and a concatenated expression collapses it to an error
    // type — every field access below then fails to typecheck.
    // The GPSR columns (0050) must be visible before the sale, so they load here.
    .select("id, title, description, price_eur, image_url, inventory_count, image_source, manufacturer_name, manufacturer_address, manufacturer_email, eu_responsible_name, eu_responsible_address, eu_responsible_email, product_identifier, safety_warnings")
    .eq("id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!product) return null;

  // The rest of the collection — a real, honest cross-sell ("More from …").
  // Their thumbnails are imagery on this page too, so their provenance counts
  // toward the disclosure exactly as the main product's does.
  const { data: related } = await supabase
    .from("products")
    .select("id, title, price_eur, image_url, image_source")
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

  /*
   * Structured data for the one page that can actually be transacted against.
   * The store page publishes an ItemList; a crawler learns the product exists
   * there and everything else here — identifier, canonical URL, price, currency,
   * live availability, seller.
   */
  const base = storefrontUrl(subdomain);
  const jsonLd = productJsonLd({
    product,
    storeName: store.store_name,
    storeUrl: base,
    productUrl: `${base}/product/${product.id}`,
    currency,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <ProductView
        storeName={store.store_name}
        subdomain={subdomain}
        storeBase={storeBase}
        currency={currency}
        ds={ds}
        product={product}
        related={related}
      />
    </>
  );
}
