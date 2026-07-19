import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem, fontStack } from "@/lib/storefront/design-system";
import { toCents, formatMoney } from "@/lib/commerce/types";
import { StoreCartProvider, CartButton, BuyBox } from "../../cart/store-cart";

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
  return { store, product };
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
  const { store, product } = data;

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));
  const p = ds.palette;
  const currency = (store as { currency?: string }).currency ?? "eur";
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  const storeBase = rootDomain.startsWith("localhost") ? `/store/${subdomain}` : "";
  const inStock = (product.inventory_count ?? 1) > 0;

  const vars: React.CSSProperties = {
    ["--bg" as string]: p.background,
    ["--surface" as string]: p.surface,
    ["--ink" as string]: p.ink,
    ["--muted" as string]: p.muted,
    ["--line" as string]: p.line,
    ["--accent" as string]: p.accent,
    ["--accent-ink" as string]: p.accentInk,
    ["--radius" as string]: `${ds.shape.radius}px`,
    ["--btn-radius" as string]: `${ds.shape.buttonShape === "pill" ? 999 : ds.shape.radius}px`,
    ["--font-b" as string]: fontStack(ds.fonts.bodyKey),
    ["--font-h" as string]: fontStack(ds.fonts.headingKey),
    background: p.background,
    color: p.ink,
    fontFamily: fontStack(ds.fonts.bodyKey),
    minHeight: "100vh",
  };

  return (
    <div id="uv-store" style={vars}>
      <style
        dangerouslySetInnerHTML={{
          __html: `#uv-store .uv-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.95rem 1.9rem;border-radius:var(--btn-radius);border:none;cursor:pointer;font-family:var(--font-b);font-size:.76rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink);background:var(--accent);transition:filter .2s ease,transform .18s ease;}#uv-store .uv-btn:hover{filter:brightness(1.05);}#uv-store .uv-btn:active{transform:translateY(1px) scale(.99);}#uv-store .uv-h{font-family:var(--font-h);line-height:1.1;}#uv-store a{color:inherit;text-decoration:none;}`,
        }}
      />
      <StoreCartProvider subdomain={subdomain} currency={currency}>
        {/* Minimal brand nav */}
        <header style={{ borderBottom: `1px solid ${p.line}` }}>
          <div style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.3rem clamp(1.25rem,4vw,2.75rem)" }}>
            <Link href={storeBase || "/"} className="uv-h" style={{ fontSize: "1.15rem", fontWeight: 600 }}>
              {store.store_name}
            </Link>
            <CartButton className="uv-navlink" />
          </div>
        </header>

        <main style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1.25rem,4vw,2.75rem)" }}>
          <Link href={`${storeBase}/#uv-shop`} style={{ fontSize: ".78rem", color: p.muted, letterSpacing: ".08em" }}>
            ← Back to shop
          </Link>

          <div style={{ display: "grid", gap: "clamp(2rem,4vw,3.5rem)", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginTop: "1.5rem", alignItems: "start" }}>
            {/* Image */}
            <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: `${ds.shape.radius}px`, overflow: "hidden", background: p.surface, border: `1px solid ${p.line}` }}>
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(150deg, ${p.surface}, ${p.accent}22)` }} />
              )}
            </div>

            {/* Details */}
            <div>
              <h1 className="uv-h" style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: `${ds.typeStyle.headingTracking}em` }}>
                {product.title}
              </h1>
              <p style={{ marginTop: "1rem", fontSize: "1.4rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(toCents(Number(product.price_eur)), currency)}
              </p>
              {product.description && (
                <p style={{ marginTop: "1.4rem", color: p.muted, lineHeight: 1.7, fontSize: "1rem", maxWidth: "46ch" }}>
                  {product.description}
                </p>
              )}
              <div style={{ marginTop: "2rem" }}>
                {inStock ? (
                  <BuyBox
                    product={{
                      productId: product.id,
                      title: product.title,
                      priceCents: toCents(Number(product.price_eur)),
                      image: product.image_url ?? null,
                    }}
                  />
                ) : (
                  <p style={{ color: p.muted, fontWeight: 600 }}>Sold out</p>
                )}
              </div>
              <p style={{ marginTop: "1.4rem", fontSize: ".8rem", color: p.muted }}>
                Secure checkout · Taxes &amp; shipping calculated at checkout.
              </p>
            </div>
          </div>
        </main>
      </StoreCartProvider>
    </div>
  );
}
