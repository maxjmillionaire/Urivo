import Link from "next/link";
import { fontStack, type StoreDesignSystem } from "@/lib/storefront/design-system";
import { toCents, formatMoney } from "@/lib/commerce/types";
import { StoreCartProvider, CartButton, BuyBox } from "../../cart/store-cart";

/*
 * The premium product page — where the customer decides to buy. Driven entirely
 * by the store's design system so it feels like the brand, not a template. The
 * product is the hero (large presentation, sticky purchase), trust is honest
 * (real service guarantees, never invented reviews or ratings), and the rest of
 * the collection is cross-sold. Presentation only — data loading lives in the
 * route, which also makes this renderable in isolation.
 */

export interface PdpProduct {
  id: string;
  title: string;
  description: string | null;
  price_eur: number | string;
  image_url?: string | null;
  inventory_count?: number | null;
}
export interface PdpRelated {
  id: string;
  title: string;
  price_eur: number | string;
  image_url?: string | null;
}

export function ProductView({
  storeName,
  subdomain,
  storeBase,
  currency,
  ds,
  product,
  related,
}: {
  storeName: string;
  subdomain: string;
  storeBase: string;
  currency: string;
  ds: StoreDesignSystem;
  product: PdpProduct;
  related: PdpRelated[];
}) {
  const p = ds.palette;
  const inStock = (product.inventory_count ?? 1) > 0;
  const brandWord = ds.personality.split(",")[0]?.trim() || "New";
  const promise = ds.brief?.positioning?.trim() || ds.story?.trim() || ds.tagline?.trim();

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
      <style dangerouslySetInnerHTML={{ __html: PDP_CSS }} />
      <StoreCartProvider subdomain={subdomain} currency={currency}>
        <header style={{ borderBottom: `1px solid ${p.line}`, position: "sticky", top: 0, zIndex: 20, background: p.background }}>
          <div style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.15rem clamp(1.25rem,4vw,2.75rem)" }}>
            <Link href={storeBase || "/"} className="uv-h" style={{ fontSize: "1.15rem", fontWeight: 600 }}>
              {storeName}
            </Link>
            <CartButton className="uv-navlink" />
          </div>
        </header>

        <main style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", padding: "clamp(1.25rem,3vw,2.25rem) clamp(1.25rem,4vw,2.75rem) clamp(3rem,6vw,6rem)" }}>
          <nav style={{ fontSize: ".76rem", color: p.muted, letterSpacing: ".04em", display: "flex", gap: ".5rem", alignItems: "center" }}>
            <Link href={storeBase || "/"}>Home</Link>
            <span aria-hidden style={{ opacity: 0.5 }}>/</span>
            <Link href={`${storeBase}/#uv-shop`}>Shop</Link>
            <span aria-hidden style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: p.ink }}>{product.title}</span>
          </nav>

          <div className="uv-pdp" style={{ display: "grid", gap: "clamp(2rem,4.5vw,4.5rem)", gridTemplateColumns: "1.05fr .95fr", marginTop: "1.6rem", alignItems: "start" }}>
            <div className="uv-gallery">
              <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: `${ds.shape.radius}px`, overflow: "hidden", background: p.surface, border: `1px solid ${p.line}` }}>
                {product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.image_url} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at 30% 20%, ${p.accent}22, transparent 60%), linear-gradient(160deg, ${p.surface}, ${p.background})` }} />
                )}
              </div>
              {product.image_url && (
                <div style={{ display: "flex", gap: ".7rem", marginTop: ".8rem" }}>
                  <div style={{ width: "5rem", aspectRatio: "1", borderRadius: `${Math.min(ds.shape.radius, 10)}px`, overflow: "hidden", border: `2px solid ${p.accent}`, background: p.surface }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                </div>
              )}
            </div>

            <div className="uv-buy" style={{ position: "sticky", top: "5.5rem" }}>
              <p className="uv-eyebrow" style={{ fontSize: ".72rem", letterSpacing: ".18em", textTransform: "uppercase", color: p.accent, fontWeight: 600 }}>{brandWord}</p>
              <h1 className="uv-h" style={{ fontSize: "clamp(1.9rem,4vw,2.8rem)", marginTop: ".7rem", letterSpacing: `${ds.typeStyle.headingTracking}em`, fontWeight: ds.typeStyle.headingWeight }}>
                {product.title}
              </h1>
              <p style={{ marginTop: "1rem", fontSize: "1.5rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(toCents(Number(product.price_eur)), currency)}
              </p>
              {product.description && (
                <p style={{ marginTop: "1.3rem", color: p.muted, lineHeight: 1.75, fontSize: "1.02rem", maxWidth: "48ch" }}>
                  {product.description}
                </p>
              )}

              <div style={{ marginTop: "1.8rem" }}>
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
                  <p style={{ color: p.muted, fontWeight: 600 }}>Sold out — back soon</p>
                )}
              </div>

              <div style={{ marginTop: "1.9rem", display: "grid", gap: "1rem", borderTop: `1px solid ${p.line}`, paddingTop: "1.6rem" }}>
                {SERVICE.map(([d, h, s]) => (
                  <div key={h} style={{ display: "flex", gap: ".85rem", alignItems: "center" }}>
                    <span style={{ color: p.accent, flexShrink: 0, display: "inline-flex" }}><Ic d={d} /></span>
                    <span style={{ fontSize: ".88rem" }}>
                      <span style={{ fontWeight: 600 }}>{h}</span>
                      <span style={{ color: p.muted }}> — {s}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        {promise && (
          <section style={{ background: p.surface, borderTop: `1px solid ${p.line}`, borderBottom: `1px solid ${p.line}` }}>
            <div style={{ maxWidth: "60ch", margin: "0 auto", padding: "clamp(3rem,6vw,5.5rem) clamp(1.25rem,4vw,2.75rem)", textAlign: "center" }}>
              <p className="uv-eyebrow" style={{ fontSize: ".72rem", letterSpacing: ".2em", textTransform: "uppercase", color: p.accent, fontWeight: 600 }}>Why {storeName}</p>
              <p className="uv-h" style={{ fontSize: "clamp(1.4rem,2.6vw,2rem)", marginTop: "1.2rem", lineHeight: 1.3 }}>{promise}</p>
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", padding: "clamp(3rem,6vw,5.5rem) clamp(1.25rem,4vw,2.75rem)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "1.8rem" }}>
              <h2 className="uv-h" style={{ fontSize: "clamp(1.3rem,2.6vw,1.9rem)" }}>More from {storeName}</h2>
              <Link href={`${storeBase}/#uv-shop`} style={{ fontSize: ".8rem", color: p.accent, letterSpacing: ".04em" }}>View all →</Link>
            </div>
            <div style={{ display: "grid", gap: "1.4rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {related.map((r) => (
                <Link key={r.id} href={`${storeBase}/product/${r.id}`} className="uv-relcard">
                  <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: `${ds.shape.radius}px`, overflow: "hidden", background: p.surface, border: `1px solid ${p.line}` }}>
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image_url} alt={r.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${p.surface}, ${p.accent}18)` }} />
                    )}
                  </div>
                  <p className="uv-h" style={{ fontSize: "1rem", marginTop: ".85rem" }}>{r.title}</p>
                  <p style={{ fontSize: ".92rem", color: p.muted, marginTop: ".2rem", fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(toCents(Number(r.price_eur)), currency)}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer style={{ borderTop: `1px solid ${p.line}` }}>
          <div style={{ maxWidth: `${ds.space.container}px`, margin: "0 auto", padding: "2rem clamp(1.25rem,4vw,2.75rem)", display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", fontSize: ".8rem", color: p.muted }}>
            <span>© {new Date().getFullYear()} {storeName}</span>
            <span style={{ letterSpacing: ".08em" }}>Secure checkout · Powered by Urivo</span>
          </div>
        </footer>
      </StoreCartProvider>
    </div>
  );
}

/* Honest, universal service reassurances — never invented social proof. */
function Ic({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const SERVICE: [string, string, string][] = [
  ["M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z M9 12l2 2 4-4", "Secure checkout", "Encrypted, end to end"],
  ["M3 7h11v8H3z M14 10h4l3 3v2h-7 M6.5 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M18 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "Tracked delivery", "Fast, insured shipping"],
  ["M3 12a9 9 0 1 0 9-9 M3 4v5h5", "30-day returns", "No questions asked"],
];

const PDP_CSS = `#uv-store .uv-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.95rem 1.9rem;border-radius:var(--btn-radius);border:none;cursor:pointer;font-family:var(--font-b);font-size:.76rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink);background:var(--accent);transition:filter .2s ease,transform .18s ease;}#uv-store .uv-btn:hover{filter:brightness(1.05);}#uv-store .uv-btn:active{transform:translateY(1px) scale(.99);}#uv-store .uv-h{font-family:var(--font-h);line-height:1.1;}#uv-store a{color:inherit;text-decoration:none;}#uv-store .uv-relcard{display:block;transition:transform .25s ease;}#uv-store .uv-relcard:hover{transform:translateY(-3px);}@media (max-width:820px){#uv-store .uv-pdp{grid-template-columns:1fr !important;}#uv-store .uv-buy{position:static !important;}}`;
