import { cache } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem, parseLogo } from "@/lib/storefront/design-system";
import { storeJsonLd, jsonLdScript } from "@/lib/seo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPublishedStorefront, resolveCustomDomain } from "@/lib/storefront/cache";
import { storeSellReadiness, shopperNotice } from "@/lib/commerce/readiness";
import { StorefrontRenderer } from "./storefront-renderer";
import { VisitBeacon } from "./visit-beacon";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

interface Props {
  params: Promise<{ subdomain: string }>;
}

// Deduped per request: metadata, viewport and the page all resolve the same
// store from one query.
// No is_active filter: RLS lets the public read active stores and the OWNER read
// their own draft. So a null result means "not found or someone else's draft"
// (→ 404), and a returned inactive store is the owner previewing before publish.
/*
 * Published stores are served from the tag-busted cache (lib/storefront/cache).
 * A store that is NOT published falls through to this RLS-scoped read, which is
 * how an owner previews their own draft — and why that path is never cached:
 * the result depends on who is asking.
 */
const loadStorefront = cache(async (slug: string) => {
  /*
   * The slug is either a subdomain (nordwerk) or a merchant's own hostname
   * (shop.nordwerk.de), rewritten here by the middleware. The two can never be
   * confused: a subdomain cannot contain a dot.
   */
  let subdomain = slug.toLowerCase();
  if (subdomain.includes(".")) {
    const owner = await resolveCustomDomain(subdomain).catch(() => null);
    // An unrecognised Host is a 404, never a fall-through to Urivo's own site.
    if (!owner) return null;
    subdomain = owner;
  }
  if (!SUBDOMAIN_PATTERN.test(subdomain)) return null;

  const published = await getPublishedStorefront(subdomain).catch(() => null);
  if (published) return { ...published, isPreview: false };

  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("id, store_name, theme_config, currency, is_active")
    .eq("subdomain", subdomain)
    .maybeSingle();
  if (!store) return null;

  // Same fallback as the cached path: an optional column must never cost the
  // merchant their whole catalogue on an un-migrated environment.
  const PRODUCT_CORE = "id, title, description, price_eur, image_url, show_logo, inventory_count";
  const full = await supabase
    .from("products")
    .select(`${PRODUCT_CORE}, image_source`)
    .eq("store_id", store.id)
    .order("position", { ascending: true });
  const products = full.error
    ? (await supabase.from("products").select(PRODUCT_CORE).eq("store_id", store.id).order("position", { ascending: true })).data
    : full.data;

  return { store, products: products ?? [], isPreview: !store.is_active };
});

function storeUrl(subdomain: string): string {
  const root = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  return root.startsWith("localhost") ? `http://localhost:3000/store/${subdomain}` : `https://${subdomain}.${root}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const sf = await loadStorefront(subdomain);
  if (!sf) return { title: "Store not found" };
  const { store, products } = sf;
  const theme = parseTheme(store.theme_config);

  const description = theme.tagline || store.store_name;
  const url = storeUrl(subdomain);
  const ogImage = products.find((p) => p.image_url)?.image_url ?? undefined;
  return {
    title: store.store_name,
    description,
    // A draft (owner preview) must never be indexed.
    ...(store.is_active ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: store.store_name,
      title: store.store_name,
      description,
      url,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: store.store_name,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

// The storefront is the merchant's brand — the mobile browser chrome should
// match their canvas, not Urivo's navy. Overrides the root themeColor here.
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { subdomain } = await params;
  const store = (await loadStorefront(subdomain))?.store ?? null;
  const theme = store ? parseTheme(store.theme_config) : null;
  return { themeColor: theme?.background ?? "#ffffff" };
}

export default async function StorefrontPage({ params }: Props) {
  const { subdomain } = await params;
  const sf = await loadStorefront(subdomain);
  if (!sf) notFound();
  const { store, products, isPreview } = sf;

  /*
   * Can this store take money? A shopper used to find out only after browsing,
   * choosing, adding to the cart and pressing Checkout — the point of maximum
   * invested effort and zero recovery. They are told up front instead, and the
   * cart's checkout button is honest rather than a dead end.
   */
  const readiness = await storeSellReadiness(supabaseAdmin(), store.id);
  const notice = readiness.canSell ? null : shopperNotice(readiness.blocker ?? "no_account");

  // New stores persist a full `designSystem`; older ones are adapted from their
  // legacy palette so nothing breaks while the generator is upgraded.
  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem, products.length)
    : themeToDesignSystem(parseTheme(store.theme_config));
  const logo = parseLogo(store.theme_config);

  const theme = parseTheme(store.theme_config);
  const jsonLd = storeJsonLd({
    storeName: store.store_name,
    tagline: theme.tagline,
    subdomain,
    url: storeUrl(subdomain),
    currency: store.currency,
    products,
  });

  return (
    <>
      {isPreview && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.6rem 1rem",
            background: "#0b1220",
            color: "#f4f1e8",
            fontSize: "13px",
            fontFamily: "system-ui, sans-serif",
            borderBottom: "1px solid rgba(232,205,128,0.3)",
          }}
        >
          <strong style={{ color: "#e8cd80" }}>Preview</strong>
          <span style={{ opacity: 0.85 }}>Only you can see this. Publish to take it live.</span>
          <a
            href="/dashboard/billing"
            style={{ color: "#e8cd80", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "3px" }}
          >
            Upgrade to publish
          </a>
        </div>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      {/*
        Told BEFORE the cart, in the merchant's own colours rather than Urivo's,
        because to the shopper this is that brand's storefront and nothing else.
        Calm and specific: browsing still works, ordering does not yet.
      */}
      {notice && !isPreview && (
        <div
          role="status"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 49,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            justifyContent: "center",
            gap: "0.45rem",
            padding: "0.7rem 1rem",
            background: ds.palette.surface,
            color: ds.palette.ink,
            borderBottom: `1px solid ${ds.palette.accent}`,
            fontSize: "13px",
            lineHeight: 1.45,
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <strong style={{ color: ds.palette.accent }}>{notice.title}</strong>
          <span style={{ opacity: 0.8 }}>{notice.detail}</span>
        </div>
      )}
      {!isPreview && <VisitBeacon subdomain={subdomain} />}
      <StorefrontRenderer
        storeName={store.store_name}
        ds={ds}
        catalog={products}
        logo={logo}
        subdomain={subdomain}
        currency={(store as { currency?: string }).currency ?? "eur"}
        canSell={readiness.canSell}
      />
    </>
  );
}
