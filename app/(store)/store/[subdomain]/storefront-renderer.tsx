import type { CSSProperties } from "react";
import {
  fontStack,
  googleFontsUrl,
  mix,
  rgba,
  sectionPadding,
  type SectionKey,
  type StoreDesignSystem,
  type StoreLogo,
  type LogoPosition,
} from "@/lib/storefront/design-system";
import type {
  NarrativeBlock,
  HeroBlock,
  MarqueeBlock,
  SpotlightBlock,
  PillarsBlock,
  ProofBlock,
  StoryBlock,
  QuoteBlock,
  TrustBlock,
  FaqBlock,
  CtaBlock,
  NewsletterBlock,
  Emphasis,
} from "@/lib/storefront/narrative";
import { toCents } from "@/lib/commerce/types";
import { StoreCartProvider, AddToCart, CartButton } from "./cart/store-cart";
import { NewsletterForm } from "./newsletter-form";

/** Build the client cart payload (display snapshot) from a catalogue product. */
function cartProduct(p: RenderProduct) {
  return {
    productId: p.id,
    title: p.title,
    priceCents: toCents(Number(p.price_eur)),
    image: p.image_url ?? null,
  };
}

/*
 * The generative storefront RENDERER.
 *
 * One component, radically different outputs. It reads a validated
 * StoreDesignSystem and composes structurally distinct section variants — nav,
 * hero, product cards, footer each have several real layouts, not restyles —
 * over a fully tokenised, self-contained (scoped) stylesheet. Two design
 * systems produce two stores that read as the work of two different agencies.
 *
 * Deliberately isolated from Urivo's own brand: the store owns its type, colour,
 * shape, motion and spacing. Urivo appears only as a quiet footer credit.
 */

export interface RenderProduct {
  id: string;
  title: string;
  description: string | null;
  price_eur: number | string;
  image_url?: string | null;
  show_logo?: boolean;
}

/** A navigation entry. Only ever built for a destination that exists. */
interface NavLink {
  label: string;
  href: string;
}

function logoAnchor(position: LogoPosition): CSSProperties {
  const pad = "6%";
  switch (position) {
    case "top-left": return { top: pad, left: pad };
    case "top-right": return { top: pad, right: pad };
    case "bottom-left": return { bottom: pad, left: pad };
    case "center": return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    default: return { bottom: pad, right: pad };
  }
}

function LogoOverlay({ logo }: { logo: StoreLogo }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo.url}
      alt=""
      aria-hidden
      style={{
        position: "absolute",
        width: `${logo.sizePct}%`,
        height: "auto",
        opacity: logo.opacity,
        objectFit: "contain",
        pointerEvents: "none",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.28))",
        ...logoAnchor(logo.position),
      }}
    />
  );
}

const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

function price(v: number | string): string {
  return `€${Number(v).toFixed(2)}`;
}

/* ------------------------------ token plumbing ----------------------------- */

function buildVars(ds: StoreDesignSystem): CSSProperties {
  const { palette: p, typeStyle: t, shape: s, space } = ds;
  const btnRadius = s.buttonShape === "sharp" ? 0 : s.buttonShape === "pill" ? 999 : s.radius;
  const heroMax = 3.2 + ((t.scale - 1.12) / (1.4 - 1.12)) * 6.2; // 3.2 → 9.4rem
  const h2Max = 1.6 + ((t.scale - 1.12) / (1.4 - 1.12)) * 1.6;

  const shadowCard =
    s.shadow === "none"
      ? "none"
      : s.shadow === "elevated"
        ? `0 2px 6px ${rgba(p.ink, 0.06)}, 0 30px 60px -28px ${rgba(p.ink, 0.4)}`
        : `0 1px 2px ${rgba(p.ink, 0.04)}, 0 14px 34px -18px ${rgba(p.ink, 0.22)}`;

  return {
    ["--bg" as string]: p.background,
    ["--surface" as string]: p.surface,
    ["--ink" as string]: p.ink,
    ["--muted" as string]: p.muted,
    ["--line" as string]: p.line,
    ["--accent" as string]: p.accent,
    ["--accent-ink" as string]: p.accentInk,
    ["--radius" as string]: `${s.radius}px`,
    ["--btn-radius" as string]: `${btnRadius}px`,
    ["--border-w" as string]: `${s.borderWidth}px`,
    ["--font-h" as string]: fontStack(ds.fonts.headingKey),
    ["--font-b" as string]: fontStack(ds.fonts.bodyKey),
    ["--h-weight" as string]: String(t.headingWeight),
    ["--h-tracking" as string]: `${t.headingTracking}em`,
    ["--h-transform" as string]: t.headingCase === "upper" ? "uppercase" : "none",
    ["--container" as string]: `${space.container}px`,
    ["--h1" as string]: `clamp(2.4rem, 7vw, ${heroMax.toFixed(2)}rem)`,
    ["--h2" as string]: `clamp(1.5rem, 3.4vw, ${h2Max.toFixed(2)}rem)`,
    ["--shadow-card" as string]: shadowCard,
    ["--pad-y" as string]: sectionPadding(space.density),
    backgroundColor: p.background,
    color: p.ink,
    fontFamily: fontStack(ds.fonts.bodyKey),
  } as CSSProperties;
}

/** Scoped stylesheet — every rule lives under #uv-store, so the store is a
 *  self-contained design system that cannot touch (or be touched by) Urivo. */
function scopedCss(ds: StoreDesignSystem): string {
  const p = ds.palette;
  const gloss1 = mix(p.accent, WHITE, 0.24);
  const gloss3 = mix(p.accent, BLACK, 0.16);
  const lively = ds.layout.motion === "lively";
  return `
#uv-store *{box-sizing:border-box;}
#uv-store{ -webkit-font-smoothing:antialiased; line-height:1.55; }
#uv-store h1,#uv-store h2,#uv-store h3,#uv-store .uv-h{ font-family:var(--font-h); font-weight:var(--h-weight); letter-spacing:var(--h-tracking); text-transform:var(--h-transform); line-height:1.05; }
#uv-store .uv-wrap{ max-width:var(--container); margin:0 auto; padding-left:clamp(1.25rem,4vw,2.75rem); padding-right:clamp(1.25rem,4vw,2.75rem); }
#uv-store .uv-eyebrow{ font-size:.7rem; letter-spacing:.28em; text-transform:uppercase; color:var(--muted); }
#uv-store a{ color:inherit; text-decoration:none; }
#uv-store .uv-navlink{ font-size:.74rem; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); transition:color .2s ease; }
#uv-store .uv-navlink:hover{ color:var(--ink); }
/* Mobile: tighten the header. The nav is now one or two real destinations, so
   they stay visible instead of being hidden as surplus decoration. */
@media (max-width: 640px){
  #uv-store header nav{ gap:1.1rem !important; }
  #uv-store header .uv-navlink{ font-size:.66rem; letter-spacing:.1em; }
  #uv-store header .uv-wrap{ padding-top:1.1rem; padding-bottom:1.1rem; }
}
#uv-store .uv-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:.5rem;
  padding:.95rem 1.9rem; border-radius:var(--btn-radius); border:none; cursor:pointer;
  font-family:var(--font-b); font-size:.76rem; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
  color:var(--accent-ink);
  background-image:linear-gradient(180deg, ${gloss1}, var(--accent) 48%, ${gloss3});
  box-shadow: inset 0 1px 0 ${rgba("#ffffff", 0.4)}, inset 0 -1px 0 ${rgba("#000000", 0.14)}, 0 10px 26px -12px ${rgba(p.accent, 0.5)};
  transition: box-shadow .24s ease, transform .18s ease, filter .24s ease;
}
#uv-store .uv-btn:active{ transform:translateY(1px) scale(.985); }
#uv-store .uv-btn-ghost{
  display:inline-flex; align-items:center; gap:.5rem; padding:.9rem 1.7rem; border-radius:var(--btn-radius);
  border:var(--border-w) solid var(--line); background:transparent; color:var(--ink); cursor:pointer;
  font-family:var(--font-b); font-size:.76rem; font-weight:600; letter-spacing:.14em; text-transform:uppercase; transition:border-color .2s ease, background .2s ease;
}
#uv-store .uv-btn-ghost:hover{ border-color:var(--ink); }
#uv-store .uv-link{ font-size:.72rem; font-weight:700; letter-spacing:.16em; text-transform:uppercase; border-bottom:2px solid var(--accent); padding-bottom:2px; transition:opacity .2s ease; }
#uv-store .uv-link:hover{ opacity:.6; }
#uv-store .uv-card .uv-plane{ transition:transform .6s cubic-bezier(.2,.7,.2,1); }
#uv-store .uv-overlay-cta{ opacity:0; transform:translateY(8px); transition:opacity .3s ease, transform .3s ease; }
#uv-store .uv-card:hover .uv-overlay-cta{ opacity:1; transform:translateY(0); }
#uv-store .uv-chip{ display:inline-flex; align-items:center; gap:.4rem; padding:.4rem .8rem; border-radius:999px; border:var(--border-w) solid var(--line); font-size:.66rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
@keyframes uv-marquee{ from{transform:translateX(0);} to{transform:translateX(-50%);} }
#uv-store .uv-marquee-track{ display:inline-flex; white-space:nowrap; animation:uv-marquee ${lively ? 18 : 32}s linear infinite; }
@keyframes uv-rise{ from{opacity:0; transform:translateY(16px);} to{opacity:1; transform:translateY(0);} }
${lively ? "#uv-store .uv-rise{ animation:uv-rise .7s cubic-bezier(.2,.7,.2,1) both; }" : ""}
#uv-store *:focus-visible{ outline:2px solid var(--accent); outline-offset:3px; }
@media (max-width: 820px){
  #uv-store .uv-hero-split{ grid-template-columns:1fr !important; }
  #uv-store .uv-foot-grid{ grid-template-columns:1fr 1fr !important; }
}
/* Motion hovers only on real pointers — a touch tap must not trigger the lift/zoom. */
@media (hover:hover) and (pointer:fine){
  #uv-store .uv-btn:hover{ filter:brightness(1.05) saturate(1.03); box-shadow: inset 0 1px 0 ${rgba("#ffffff", 0.5)}, 0 16px 36px -12px ${rgba(p.accent, 0.55)}; transform:translateY(-1px); }
  #uv-store .uv-card:hover .uv-plane{ transform:scale(1.045); }
}
@media (prefers-reduced-motion: reduce){ #uv-store *{ animation:none !important; } #uv-store .uv-card .uv-plane{ transform:none; } }
`;
}

/* ------------------------------ image planes ------------------------------- */

function planeStyle(ds: StoreDesignSystem): CSSProperties {
  const p = ds.palette;
  switch (ds.layout.imageTreatment) {
    case "duotone":
      return { background: `linear-gradient(150deg, ${rgba(p.accent, 0.35)}, ${rgba(p.ink, 0.6)})` };
    case "framed":
      return { background: p.surface, boxShadow: `inset 0 0 0 1px ${p.line}, inset 0 0 60px ${rgba(p.ink, 0.05)}` };
    case "editorial":
      return { background: `linear-gradient(180deg, ${mix(p.surface, WHITE, 0.02)}, ${p.surface})` };
    default:
      return { background: `linear-gradient(155deg, ${mix(p.surface, WHITE, 0.03)}, ${mix(p.surface, BLACK, 0.05)})` };
  }
}

function Plane({
  ds,
  index,
  src,
  alt,
  logo,
}: {
  ds: StoreDesignSystem;
  index: number;
  src?: string | null;
  alt?: string;
  logo?: StoreLogo | null;
}) {
  const p = ds.palette;
  // Real product photography when available; the palette plane is the fallback.
  if (src) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="uv-plane"
          src={src}
          alt={alt || ""}
          loading="lazy"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        {ds.layout.imageTreatment === "duotone" && (
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", background: `linear-gradient(150deg, ${rgba(p.accent, 0.4)}, ${rgba(p.ink, 0.5)})` }} />
        )}
        {logo && <LogoOverlay logo={logo} />}
      </>
    );
  }
  // Intentional branded placeholder (never an empty plane or broken-image icon).
  // Derived entirely from the merchant's own design system — palette field, a
  // soft accent light, and the product's monogram set in the brand's heading
  // face — so a store with images pending still looks deliberate, not broken.
  const monogram = monogramOf(alt);
  return (
    <div className="uv-plane" style={{ position: "absolute", inset: 0, ...planeStyle(ds) }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 90% at 30% 18%, ${rgba(p.accent, 0.16)}, transparent 60%)`,
        }}
      />
      {monogram && (
        <span
          className="uv-h"
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "clamp(1.5rem, 6vw, 3.75rem)",
            fontWeight: Math.max(ds.typeStyle.headingWeight, 600),
            letterSpacing: "0.04em",
            color: rgba(p.ink, 0.16),
            userSelect: "none",
          }}
        >
          {monogram}
        </span>
      )}
      <span
        className="uv-h"
        style={{ position: "absolute", left: "1rem", top: "0.85rem", fontSize: ".7rem", letterSpacing: ".2em", opacity: 0.4 }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Up to two initials from a product title, for the branded image placeholder. */
function monogramOf(alt?: string): string {
  if (!alt) return "";
  const words = alt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const initials = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return initials || (alt[0]?.toUpperCase() ?? "");
}

/* --------------------------------- NAV ------------------------------------- */

/**
 * Navigation over REAL destinations.
 *
 * This used to render Shop · About · Journal · Reviews on every store, all four
 * pointing at the product grid. "Reviews" on a shop that has never had a
 * customer is invented social proof, and a link that lies about where it goes is
 * the loudest template tell on the page. The nav now lists only what the store
 * actually has: the catalogue, and the story when one was written.
 */
function Nav({ storeName, ds, links }: { storeName: string; ds: StoreDesignSystem; links: NavLink[] }) {
  const brand = (
    <span className="uv-h" style={{ fontSize: "1.15rem", fontWeight: Math.max(ds.typeStyle.headingWeight, 600) }}>
      {storeName}
    </span>
  );
  const cart = <CartButton className="uv-navlink" />;

  if (ds.layout.nav === "centered") {
    return (
      <header style={{ borderBottom: `var(--border-w) solid ${ds.palette.line}` }}>
        <div className="uv-wrap" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "1rem", padding: "1.4rem 0" }}>
          <nav style={{ display: "flex", gap: "1.6rem" }}>
            {links.map((l) => (
              <a key={l.href} href={l.href} className="uv-navlink">{l.label}</a>
            ))}
          </nav>
          <div style={{ justifySelf: "center" }}>{brand}</div>
          <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: "1.4rem" }}>{cart}</div>
        </div>
      </header>
    );
  }
  if (ds.layout.nav === "bordered") {
    return (
      <header style={{ margin: "1rem", border: `var(--border-w) solid ${ds.palette.line}`, borderRadius: "var(--radius)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.4rem" }}>
          {brand}
          <nav style={{ display: "flex", gap: "1.8rem" }}>
            {links.map((l) => (
              <a key={l.href} href={l.href} className="uv-navlink">{l.label}</a>
            ))}
          </nav>
          {cart}
        </div>
      </header>
    );
  }
  if (ds.layout.nav === "minimal") {
    return (
      <header>
        <div className="uv-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.8rem 0" }}>
          {brand}
          <CartButton className="uv-navlink" />
        </div>
      </header>
    );
  }
  // editorial (default)
  return (
    <header style={{ borderBottom: `var(--border-w) solid ${ds.palette.line}` }}>
      <div className="uv-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.35rem 0" }}>
        {brand}
        <nav style={{ display: "flex", alignItems: "center", gap: "1.9rem" }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="uv-navlink">{l.label}</a>
          ))}
          {cart}
        </nav>
      </div>
    </header>
  );
}

/* --------------------------------- HERO ------------------------------------ */

/*
 * Taglines are AI-written, so they arrive with or without a full stop. Append
 * one only when it is missing — hardcoding "{tagline}." rendered a doubled
 * mark on every storefront whose tagline already ended in punctuation.
 */
function withStop(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function Hero({ storeName, ds, heroImage, logo, storyHref }: { storeName: string; ds: StoreDesignSystem; heroImage?: string | null; logo?: StoreLogo | null; storyHref?: string | null }) {
  const tagline = withStop(ds.tagline || ds.personality);
  const eyebrow = "New collection";

  if (ds.layout.hero === "split") {
    return (
      <section className="uv-wrap" style={{ paddingTop: "clamp(2.5rem,5vw,4.5rem)", paddingBottom: "var(--pad-y)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "3rem", alignItems: "center" }}>
          <div style={{ display: "grid", gap: "3rem", gridTemplateColumns: "1.05fr 1fr" }} className="uv-hero-split">
            <div className="uv-rise">
              <p className="uv-eyebrow">{eyebrow}</p>
              <h1 style={{ fontSize: "var(--h1)", marginTop: "1.2rem" }}>{storeName}</h1>
              <p style={{ marginTop: "1.4rem", maxWidth: "34ch", color: "var(--muted)", fontSize: "1.05rem" }}>{tagline}</p>
              <div style={{ marginTop: "2.2rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <a href="#uv-shop" className="uv-btn">Shop the collection</a>
                {/* Only offered when there is a story to go to. */}
                {storyHref && <a href={storyHref} className="uv-btn-ghost">Our story</a>}
              </div>
            </div>
            <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: "var(--radius)", overflow: "hidden" }} className="uv-card">
              <Plane ds={ds} index={0} src={heroImage} logo={heroImage ? logo : null} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (ds.layout.hero === "fullbleed") {
    return (
      <section style={{ position: "relative", minHeight: "72vh", display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
        {heroImage ? (
          // The hero is the LCP element on every storefront, so it is never
          // lazy or low-priority: the merchant paid for this click and the
          // first paint decides whether it converts. Decorative (the headline
          // carries the meaning), hence the empty alt.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            fetchPriority="high"
            decoding="async"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, ...planeStyle(ds) }} />
        )}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba(ds.palette.background, 0.1)} 20%, ${rgba(ds.palette.background, 0.92)})` }} />
        <div className="uv-wrap uv-rise" style={{ position: "relative", paddingBottom: "clamp(3rem,6vw,6rem)", paddingTop: "6rem" }}>
          <p className="uv-eyebrow">{eyebrow}</p>
          <h1 style={{ fontSize: "var(--h1)", marginTop: "1rem", maxWidth: "16ch" }}>{storeName}</h1>
          <p style={{ marginTop: "1.3rem", maxWidth: "40ch", color: "var(--muted)", fontSize: "1.1rem" }}>{tagline}</p>
          <a href="#uv-shop" className="uv-btn" style={{ marginTop: "2rem", display: "inline-block" }}>Shop now</a>
        </div>
      </section>
    );
  }

  if (ds.layout.hero === "statement") {
    return (
      <section className="uv-wrap uv-rise" style={{ paddingTop: "clamp(4rem,9vw,9rem)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
        <p className="uv-eyebrow">{eyebrow}</p>
        <h1 style={{ fontSize: "var(--h1)", marginTop: "1.4rem", marginLeft: "auto", marginRight: "auto", maxWidth: "14ch" }}>{storeName}</h1>
        <p style={{ marginTop: "1.6rem", maxWidth: "48ch", marginLeft: "auto", marginRight: "auto", color: "var(--muted)", fontSize: "1.12rem" }}>{tagline}</p>
        <div style={{ marginTop: "2.4rem" }}>
          <a href="#uv-shop" className="uv-btn">Explore</a>
        </div>
      </section>
    );
  }

  // editorial (default)
  return (
    <section className="uv-wrap uv-rise" style={{ paddingTop: "clamp(3rem,6vw,6rem)", paddingBottom: "var(--pad-y)" }}>
      <p className="uv-eyebrow">{eyebrow}</p>
      <h1 style={{ fontSize: "var(--h1)", marginTop: "1.3rem", maxWidth: "18ch" }}>{storeName}</h1>
      <p style={{ marginTop: "1.5rem", maxWidth: "44ch", color: "var(--muted)", fontSize: "1.1rem", fontStyle: ds.fonts.headingKey === "playfair" ? "italic" : "normal" }}>{tagline}</p>
      <a href="#uv-shop" className="uv-btn" style={{ marginTop: "2.2rem", display: "inline-block" }}>Shop the collection</a>
    </section>
  );
}

/* ------------------------------ PRODUCT CARDS ------------------------------ */

function ProductCard({ ds, product, index, logo, href }: { ds: StoreDesignSystem; product: RenderProduct; index: number; logo?: StoreLogo | null; href: string }) {
  const variant = ds.layout.card;
  const cardLogo = logo && product.show_logo !== false ? logo : null;

  if (variant === "overlay") {
    return (
      <article className="uv-card" style={{ position: "relative", aspectRatio: "3 / 4", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
        <Plane ds={ds} index={index} src={product.image_url} alt={product.title} logo={cardLogo} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 45%, ${rgba(ds.palette.ink, 0.55)})` }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "1.2rem" }}>
          <h3 className="uv-h" style={{ color: "#fff", fontSize: "1.05rem" }}><a href={href}>{product.title}</a></h3>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: ".4rem" }}>
            <span style={{ color: "#fff", opacity: 0.85, fontSize: ".9rem" }}>{price(product.price_eur)}</span>
            <AddToCart product={cartProduct(product)} label="Add" className="uv-btn uv-overlay-cta" style={{ padding: ".55rem 1rem", fontSize: ".64rem" }} />
          </div>
        </div>
      </article>
    );
  }

  if (variant === "framed") {
    return (
      <article className="uv-card" style={{ border: `var(--border-w) solid ${ds.palette.line}`, borderRadius: "var(--radius)", padding: "1rem", background: "var(--surface)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: "calc(var(--radius) * .7)", overflow: "hidden" }}>
          <Plane ds={ds} index={index} src={product.image_url} alt={product.title} logo={cardLogo} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", marginTop: "1rem" }}>
          <h3 className="uv-h" style={{ fontSize: "1.02rem" }}><a href={href}>{product.title}</a></h3>
          <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{price(product.price_eur)}</span>
        </div>
        {product.description && <p style={{ marginTop: ".5rem", fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.55 }}>{product.description}</p>}
        <AddToCart product={cartProduct(product)} className="uv-btn" style={{ marginTop: "1rem", width: "100%" }} />
      </article>
    );
  }

  if (variant === "minimal") {
    return (
      <article className="uv-card">
        <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <Plane ds={ds} index={index} src={product.image_url} alt={product.title} logo={cardLogo} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: ".8rem" }}>
          <h3 className="uv-h" style={{ fontSize: ".96rem", fontWeight: 500 }}><a href={href}>{product.title}</a></h3>
          <span style={{ fontSize: ".9rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{price(product.price_eur)}</span>
        </div>
        <div style={{ marginTop: ".7rem" }}>
          <AddToCart product={cartProduct(product)} className="uv-link" style={{ background: "none", cursor: "pointer" }} />
        </div>
      </article>
    );
  }

  // editorial (default)
  return (
    <article className="uv-card">
      <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
        <Plane ds={ds} index={index} src={product.image_url} alt={product.title} logo={cardLogo} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", marginTop: "1.1rem" }}>
        <h3 className="uv-h" style={{ fontSize: "1.12rem" }}><a href={href}>{product.title}</a></h3>
        <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{price(product.price_eur)}</span>
      </div>
      {product.description && <p style={{ marginTop: ".55rem", fontSize: ".9rem", color: "var(--muted)", lineHeight: 1.6 }}>{product.description}</p>}
      <div style={{ marginTop: "1rem" }}>
        <AddToCart product={cartProduct(product)} className="uv-link" style={{ background: "none", cursor: "pointer" }} />
      </div>
    </article>
  );
}

function Collection({ ds, catalog, logo, storeBase, title }: { ds: StoreDesignSystem; catalog: RenderProduct[]; logo?: StoreLogo | null; storeBase: string; title?: string }) {
  if (catalog.length === 0) {
    return (
      <section className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
        <p className="uv-eyebrow">Opening soon</p>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginTop: "1rem" }}>The collection is being curated.</h2>
      </section>
    );
  }
  const cols = ds.layout.card === "minimal" ? 4 : ds.layout.card === "overlay" ? 3 : 3;
  return (
    <section id="uv-shop" className="uv-wrap" style={{ paddingTop: "calc(var(--pad-y) * .5)", paddingBottom: "var(--pad-y)", scrollMarginTop: "5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "2.4rem" }}>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)" }}>{title ?? "The collection"}</h2>
        <span className="uv-eyebrow">{catalog.length} pieces</span>
      </div>
      <div
        style={{
          display: "grid",
          gap: ds.space.density === "tight" ? "1.2rem" : "clamp(1.4rem, 2.4vw, 2.4rem)",
          gridTemplateColumns: `repeat(auto-fill, minmax(${cols === 4 ? 200 : 260}px, 1fr))`,
        }}
      >
        {catalog.map((product, i) => (
          <ProductCard key={product.id} ds={ds} product={product} index={i} logo={logo} href={`${storeBase}/product/${product.id}`} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ OTHER SECTIONS ----------------------------- */

function Announcement({ ds }: { ds: StoreDesignSystem }) {
  if (!ds.layout.announcement) return null;
  return (
    <div style={{ background: ds.palette.accent, color: ds.palette.accentInk, textAlign: "center", padding: ".6rem 1rem", fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 600 }}>
      {ds.layout.announcement}
    </div>
  );
}

function Marquee({ ds, storeName }: { ds: StoreDesignSystem; storeName: string }) {
  const word = ds.personality.split(",")[0] || storeName;
  const run = Array.from({ length: 8 }).map((_, i) => (
    <span key={i} className="uv-h" style={{ fontSize: "clamp(1.6rem,4vw,3rem)", padding: "0 1.5rem", opacity: 0.9 }}>
      {word} <span style={{ color: "var(--accent)" }}>✦</span>
    </span>
  ));
  return (
    <section style={{ borderTop: `var(--border-w) solid ${ds.palette.line}`, borderBottom: `var(--border-w) solid ${ds.palette.line}`, padding: "1.4rem 0", overflow: "hidden" }}>
      <div className="uv-marquee-track">
        {run}
        {run}
      </div>
    </section>
  );
}

/*
 * Risk reduction — rendered ONLY from promises this brand authored.
 *
 * This section used to ship a fixed list: free shipping over €60, 30-day
 * returns, encrypted checkout. Every store published it, so every merchant was
 * publishing binding commercial terms they had never agreed to. The renderer
 * does not get to make promises on a merchant's behalf; no authored items, no
 * section.
 */
function Trust({ ds }: { ds: StoreDesignSystem }) {
  const items = ds.trust ?? [];
  if (!items.length) return null;
  return (
    <section className="uv-wrap" style={{ paddingTop: "calc(var(--pad-y) * .5)", paddingBottom: "calc(var(--pad-y) * .5)" }}>
      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", borderTop: `var(--border-w) solid ${ds.palette.line}`, paddingTop: "2.2rem" }}>
        {items.map((it) => (
          <div key={it.title}>
            <p className="uv-h" style={{ fontSize: ".98rem" }}>{it.title}</p>
            <p style={{ marginTop: ".4rem", fontSize: ".84rem", color: "var(--muted)", lineHeight: 1.55 }}>{it.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Story({ ds, storeName }: { ds: StoreDesignSystem; storeName: string }) {
  // The real, on-brand narrative the Creative Director wrote. The old fallback
  // asserted small production runs and long-lived materials on behalf of any
  // brand that lacked a story — a manufacturing claim the renderer cannot know
  // to be true. A brand with no story told tells none.
  const narrative = ds.story?.trim();
  if (!narrative) return null;
  const positioning = ds.brief?.positioning?.trim();
  return (
    <section id="uv-story" className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", scrollMarginTop: "5rem" }}>
      <div style={{ display: "grid", gap: "2.5rem", gridTemplateColumns: "1fr", maxWidth: "64ch" }}>
        <div>
          <p className="uv-eyebrow">The story</p>
          <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginTop: "1.2rem" }}>
            {positioning || `Why ${storeName} exists.`}
          </h2>
          <p style={{ marginTop: "1.4rem", color: "var(--muted)", fontSize: "1.05rem", lineHeight: 1.7 }}>
            {narrative}
          </p>
        </div>
      </div>
    </section>
  );
}

/* Reasons to want the brand — authored, or absent. The previous fixed list
 * claimed considered materials, small production runs and carbon-offset
 * delivery for every store ever generated, including ones selling none of it. */
function Highlights({ ds }: { ds: StoreDesignSystem }) {
  const items = ds.highlights ?? [];
  if (!items.length) return null;
  return (
    <section className="uv-wrap" style={{ paddingTop: "calc(var(--pad-y) * .6)", paddingBottom: "calc(var(--pad-y) * .6)" }}>
      <div style={{ display: "grid", gap: "1.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {items.map((it, i) => (
          <div key={it.title} style={{ padding: "1.6rem", border: `var(--border-w) solid ${ds.palette.line}`, borderRadius: "var(--radius)", background: "var(--surface)" }}>
            <span className="uv-h" style={{ color: "var(--accent)", fontSize: "1.4rem" }}>{String(i + 1).padStart(2, "0")}</span>
            <p className="uv-h" style={{ fontSize: "1.05rem", marginTop: ".8rem" }}>{it.title}</p>
            <p style={{ marginTop: ".5rem", fontSize: ".88rem", color: "var(--muted)", lineHeight: 1.55 }}>{it.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Newsletter({ ds, storeName, subdomain }: { ds: StoreDesignSystem; storeName: string; subdomain: string }) {
  return (
    <section style={{ background: "var(--surface)", borderTop: `var(--border-w) solid ${ds.palette.line}` }}>
      <div className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", maxWidth: "20ch", margin: "0 auto" }}>Join the {storeName} list</h2>
        <p style={{ marginTop: "1rem", color: "var(--muted)" }}>News from {storeName}, and nothing else.</p>
        <NewsletterForm subdomain={subdomain} source="newsletter" />
      </div>
    </section>
  );
}

function Footer({ ds, storeName, catalog, storeBase, links }: {
  ds: StoreDesignSystem;
  storeName: string;
  catalog: RenderProduct[];
  storeBase: string;
  links: NavLink[];
}) {
  if (ds.layout.footer === "bold") {
    return (
      <footer style={{ background: ds.palette.accent, color: ds.palette.accentInk }}>
        <div className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "2rem" }}>
          <p className="uv-h" style={{ fontSize: "clamp(2.5rem,9vw,7rem)", lineHeight: 0.95 }}>{storeName}</p>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginTop: "3rem", opacity: 0.9, fontSize: ".8rem" }}>
            <span>© {new Date().getFullYear()} {storeName}</span>
            <span style={{ letterSpacing: ".2em", textTransform: "uppercase", opacity: 0.7 }}>Powered by Urivo</span>
          </div>
        </div>
      </footer>
    );
  }
  if (ds.layout.footer === "minimal") {
    return (
      <footer style={{ borderTop: `var(--border-w) solid ${ds.palette.line}` }}>
        <div className="uv-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", padding: "2.2rem 0" }}>
          <span className="uv-h" style={{ fontSize: "1rem" }}>{storeName}</span>
          <span className="uv-eyebrow">Powered by Urivo</span>
        </div>
      </footer>
    );
  }
  /*
   * The editorial footer used to print twelve links — New in, Best sellers,
   * Gift cards, Materials, Sustainability, Shipping, Returns, FAQ, Care guide —
   * every one of them pointing at the product grid. None of those pages exist,
   * "Best sellers" claims sales this store has never made, and "Sustainability"
   * is a regulated claim rendered as furniture. It now lists the real catalogue
   * and the real anchors, which is also what a good small brand's footer does.
   */
  const cols: { heading: string; items: NavLink[] }[] = [];
  if (catalog.length) {
    cols.push({
      heading: "The collection",
      items: catalog.slice(0, 6).map((p) => ({ label: p.title, href: `${storeBase}/product/${p.id}` })),
    });
  }
  if (links.length) cols.push({ heading: "Explore", items: links });

  return (
    <footer style={{ borderTop: `var(--border-w) solid ${ds.palette.line}` }}>
      <div className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "2.4rem" }}>
        <div
          className="uv-foot-grid"
          style={{ display: "grid", gap: "2.4rem", gridTemplateColumns: `1.4fr ${cols.map(() => "1fr").join(" ")}`.trim() }}
        >
          <div>
            <p className="uv-h" style={{ fontSize: "1.35rem" }}>{storeName}</p>
            <p style={{ marginTop: ".9rem", color: "var(--muted)", fontSize: ".9rem", maxWidth: "28ch" }}>{ds.personality}.</p>
          </div>
          {cols.map((col) => (
            <div key={col.heading}>
              <p className="uv-eyebrow">{col.heading}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0", display: "grid", gap: ".6rem" }}>
                {col.items.map((it) => (
                  <li key={it.href}>
                    <a href={it.href} className="uv-navlink" style={{ textTransform: "none", letterSpacing: 0, fontSize: ".88rem" }}>{it.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginTop: "3rem", paddingTop: "1.6rem", borderTop: `var(--border-w) solid ${ds.palette.line}`, color: "var(--muted)", fontSize: ".8rem" }}>
          <span>© {new Date().getFullYear()} {storeName}</span>
          <span className="uv-eyebrow">Powered by Urivo</span>
        </div>
      </div>
    </footer>
  );
}

/* ============================ AUTHORED NARRATIVE ==========================
 * The renderer as a faithful typesetting surface: it renders the Creative
 * Director's authored beats, never boilerplate. Every string here comes from
 * the model's narrative content; the design system supplies only the form.
 * ========================================================================= */

interface NarrativeCtx {
  ds: StoreDesignSystem;
  storeName: string;
  catalog: RenderProduct[];
  storeBase: string;
  logo?: StoreLogo | null;
  heroImage: string | null;
  subdomain: string;
}

const npad = (e: Emphasis): string => (e === "bold" ? "var(--pad-y)" : "calc(var(--pad-y) * .62)");
const pdpHref = (ctx: NarrativeCtx, p: RenderProduct) => `${ctx.storeBase}/product/${p.id}`;

function NHero({ block, ctx }: { block: HeroBlock; ctx: NarrativeCtx }) {
  const { ds, catalog, logo, heroImage } = ctx;
  const prod = block.heroProductIndex != null ? catalog[block.heroProductIndex] : null;
  const img = prod?.image_url ?? heroImage;
  const cta = prod ? pdpHref(ctx, prod) : "#uv-shop";
  const padTop = block.emphasis === "bold" ? "clamp(3.5rem,7vw,7rem)" : "clamp(2.5rem,5vw,4.5rem)";

  if (img) {
    return (
      <section className="uv-wrap" style={{ paddingTop: padTop, paddingBottom: "var(--pad-y)" }}>
        <div className="uv-hero-split" style={{ display: "grid", gap: "clamp(2rem,4vw,3.5rem)", gridTemplateColumns: "1.05fr 1fr", alignItems: "center" }}>
          <div className="uv-rise">
            {block.eyebrow && <p className="uv-eyebrow">{block.eyebrow}</p>}
            <h1 style={{ fontSize: "var(--h1)", marginTop: block.eyebrow ? "1.2rem" : 0, maxWidth: "18ch" }}>{block.headline}</h1>
            {block.subhead && <p style={{ marginTop: "1.4rem", maxWidth: "40ch", color: "var(--muted)", fontSize: "1.08rem", lineHeight: 1.65 }}>{block.subhead}</p>}
            <div style={{ marginTop: "2.2rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <a href={cta} className="uv-btn">{block.ctaLabel}</a>
              <a href="#uv-shop" className="uv-btn-ghost">Explore the collection</a>
            </div>
          </div>
          <div className="uv-card" style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <Plane ds={ds} index={0} src={img} logo={logo} />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="uv-wrap uv-rise" style={{ paddingTop: padTop, paddingBottom: "var(--pad-y)" }}>
      {block.eyebrow && <p className="uv-eyebrow">{block.eyebrow}</p>}
      <h1 style={{ fontSize: "var(--h1)", marginTop: block.eyebrow ? "1.3rem" : 0, maxWidth: "20ch" }}>{block.headline}</h1>
      {block.subhead && <p style={{ marginTop: "1.5rem", maxWidth: "46ch", color: "var(--muted)", fontSize: "1.12rem", lineHeight: 1.6 }}>{block.subhead}</p>}
      <a href={cta} className="uv-btn" style={{ marginTop: "2.2rem", display: "inline-block" }}>{block.ctaLabel}</a>
    </section>
  );
}

function NMarquee({ block, ds }: { block: MarqueeBlock; ds: StoreDesignSystem }) {
  const run = [...block.phrases, ...block.phrases].map((phrase, i) => (
    <span key={i} className="uv-h" style={{ fontSize: "clamp(1.2rem,2.6vw,2rem)", padding: "0 1.4rem", opacity: 0.92, whiteSpace: "nowrap" }}>
      {phrase} <span style={{ color: "var(--accent)" }}>✦</span>
    </span>
  ));
  return (
    <section style={{ borderTop: `var(--border-w) solid ${ds.palette.line}`, borderBottom: `var(--border-w) solid ${ds.palette.line}`, padding: "1.2rem 0", overflow: "hidden" }}>
      <div className="uv-marquee-track">{run}</div>
    </section>
  );
}

function NSpotlight({ block, ctx }: { block: SpotlightBlock; ctx: NarrativeCtx }) {
  const { ds, catalog, logo } = ctx;
  const prod = catalog[block.productIndex];
  if (!prod) return null;
  return (
    <section className="uv-wrap" style={{ paddingTop: npad(block.emphasis), paddingBottom: npad(block.emphasis) }}>
      <div className="uv-hero-split" style={{ display: "grid", gap: "clamp(2rem,4vw,3.5rem)", gridTemplateColumns: "1fr 1fr", alignItems: "center" }}>
        <div className="uv-card" style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
          <Plane ds={ds} index={block.productIndex} src={prod.image_url} alt={prod.title} logo={logo} />
        </div>
        <div>
          {block.eyebrow && <p className="uv-eyebrow">{block.eyebrow}</p>}
          <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginTop: block.eyebrow ? "1rem" : 0 }}>{block.headline}</h2>
          {block.benefits.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "1.6rem 0 0", display: "grid", gap: ".85rem" }}>
              {block.benefits.map((b) => (
                <li key={b} style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", fontSize: "1rem", lineHeight: 1.5 }}>
                  <span style={{ color: "var(--accent)", marginTop: ".1rem", flexShrink: 0 }}>✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: "2rem", display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.35rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{price(prod.price_eur)}</span>
            <AddToCart product={cartProduct(prod)} label={block.ctaLabel} className="uv-btn" />
            <a href={pdpHref(ctx, prod)} className="uv-link">View details</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function NPillars({ block }: { block: PillarsBlock }) {
  return (
    <section className="uv-wrap" style={{ paddingTop: npad(block.emphasis), paddingBottom: npad(block.emphasis) }}>
      {block.title && <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginBottom: "2rem", maxWidth: "22ch" }}>{block.title}</h2>}
      <div style={{ display: "grid", gap: "clamp(1.6rem,3vw,3rem)", gridTemplateColumns: `repeat(auto-fit, minmax(${block.items.length >= 3 ? 220 : 280}px, 1fr))` }}>
        {block.items.map((it, i) => (
          <div key={it.title}>
            <span className="uv-h" style={{ color: "var(--accent)", fontSize: "1.1rem", fontVariantNumeric: "tabular-nums" }}>{String(i + 1).padStart(2, "0")}</span>
            <p className="uv-h" style={{ fontSize: "1.2rem", marginTop: ".9rem" }}>{it.title}</p>
            <p style={{ marginTop: ".6rem", color: "var(--muted)", fontSize: ".96rem", lineHeight: 1.6 }}>{it.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NProof({ block, ds }: { block: ProofBlock; ds: StoreDesignSystem }) {
  return (
    <section style={{ background: "var(--surface)", borderTop: `var(--border-w) solid ${ds.palette.line}`, borderBottom: `var(--border-w) solid ${ds.palette.line}` }}>
      <div className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)" }}>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", maxWidth: "24ch", marginBottom: "2.4rem" }}>{block.title}</h2>
        <div style={{ display: "grid", gap: "0" }}>
          {block.items.map((it, i) => (
            <div key={it.label} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 22%) 1fr", gap: "1.5rem", padding: "1.4rem 0", borderTop: i === 0 ? "none" : `var(--border-w) solid ${ds.palette.line}` }}>
              <p className="uv-h" style={{ fontSize: "1.02rem" }}>{it.label}</p>
              <p style={{ color: "var(--muted)", fontSize: ".98rem", lineHeight: 1.65 }}>{it.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NStory({ block }: { block: StoryBlock }) {
  return (
    <section id="uv-story" className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", scrollMarginTop: "5rem" }}>
      <div style={{ maxWidth: "64ch" }}>
        {block.eyebrow && <p className="uv-eyebrow">{block.eyebrow}</p>}
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginTop: block.eyebrow ? "1.2rem" : 0, maxWidth: "26ch" }}>{block.headline}</h2>
        <p style={{ marginTop: "1.4rem", color: "var(--muted)", fontSize: "1.08rem", lineHeight: 1.75 }}>{block.body}</p>
      </div>
    </section>
  );
}

function NQuote({ block }: { block: QuoteBlock }) {
  return (
    <section className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
      <blockquote className="uv-h" style={{ fontSize: "clamp(1.6rem,3.6vw,2.6rem)", lineHeight: 1.3, maxWidth: "24ch", margin: "0 auto", letterSpacing: "-0.01em" }}>
        {block.text}
      </blockquote>
      {block.attribution && <p style={{ marginTop: "1.6rem", color: "var(--muted)", fontSize: ".9rem", letterSpacing: ".08em", textTransform: "uppercase" }}>{block.attribution}</p>}
    </section>
  );
}

function NTrust({ block, ds }: { block: TrustBlock; ds: StoreDesignSystem }) {
  return (
    <section className="uv-wrap" style={{ paddingTop: npad(block.emphasis), paddingBottom: npad(block.emphasis) }}>
      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", borderTop: `var(--border-w) solid ${ds.palette.line}`, paddingTop: "2.2rem" }}>
        {block.items.map((it) => (
          <div key={it.title}>
            <p className="uv-h" style={{ fontSize: ".98rem" }}>{it.title}</p>
            <p style={{ marginTop: ".4rem", fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.55 }}>{it.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NFaq({ block, ds }: { block: FaqBlock; ds: StoreDesignSystem }) {
  return (
    <section className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)" }}>
      <div style={{ maxWidth: "72ch" }}>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", marginBottom: "1.8rem" }}>Questions</h2>
        {block.items.map((it, i) => (
          <details key={it.q} style={{ borderTop: i === 0 ? `var(--border-w) solid ${ds.palette.line}` : "none", borderBottom: `var(--border-w) solid ${ds.palette.line}`, padding: "1.15rem 0" }}>
            <summary className="uv-h" style={{ fontSize: "1.05rem", cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              {it.q}<span style={{ color: "var(--accent)" }}>+</span>
            </summary>
            <p style={{ marginTop: ".9rem", color: "var(--muted)", fontSize: ".98rem", lineHeight: 1.7, maxWidth: "60ch" }}>{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function NCta({ block }: { block: CtaBlock }) {
  return (
    <section className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
      <h2 className="uv-h" style={{ fontSize: "var(--h2)", maxWidth: "22ch", margin: "0 auto" }}>{block.headline}</h2>
      {block.subhead && <p style={{ marginTop: "1.1rem", color: "var(--muted)", fontSize: "1.05rem", maxWidth: "44ch", marginInline: "auto" }}>{block.subhead}</p>}
      <a href="#uv-shop" className="uv-btn" style={{ marginTop: "2rem", display: "inline-block" }}>{block.ctaLabel}</a>
    </section>
  );
}

function NNewsletter({ block, ds, subdomain }: { block: NewsletterBlock; ds: StoreDesignSystem; subdomain: string }) {
  return (
    <section style={{ background: "var(--surface)", borderTop: `var(--border-w) solid ${ds.palette.line}` }}>
      <div className="uv-wrap" style={{ paddingTop: "var(--pad-y)", paddingBottom: "var(--pad-y)", textAlign: "center" }}>
        <h2 className="uv-h" style={{ fontSize: "var(--h2)", maxWidth: "22ch", margin: "0 auto" }}>{block.headline}</h2>
        <p style={{ marginTop: "1rem", color: "var(--muted)" }}>{block.subhead}</p>
        <NewsletterForm subdomain={subdomain} source="newsletter" />
      </div>
    </section>
  );
}

function renderBlock(block: NarrativeBlock, i: number, ctx: NarrativeCtx): React.ReactNode {
  const key = `${block.kind}-${i}`;
  switch (block.kind) {
    case "hero": return <NHero key={key} block={block} ctx={ctx} />;
    case "marquee": return <NMarquee key={key} block={block} ds={ctx.ds} />;
    case "spotlight": return <NSpotlight key={key} block={block} ctx={ctx} />;
    case "pillars": return <NPillars key={key} block={block} />;
    case "proof": return <NProof key={key} block={block} ds={ctx.ds} />;
    case "story": return <NStory key={key} block={block} />;
    case "quote": return <NQuote key={key} block={block} />;
    case "trust": return <NTrust key={key} block={block} ds={ctx.ds} />;
    case "faq": return <NFaq key={key} block={block} ds={ctx.ds} />;
    case "collection": return <Collection key={key} ds={ctx.ds} catalog={ctx.catalog} logo={ctx.logo} storeBase={ctx.storeBase} title={block.title ?? undefined} />;
    case "cta": return <NCta key={key} block={block} />;
    case "newsletter": return <NNewsletter key={key} block={block} ds={ctx.ds} subdomain={ctx.subdomain} />;
    default: return null;
  }
}

/* -------------------------------- assembly --------------------------------- */

export function StorefrontRenderer({
  storeName,
  ds,
  catalog,
  logo,
  subdomain,
  currency = "eur",
  canSell = true,
}: {
  storeName: string;
  ds: StoreDesignSystem;
  catalog: RenderProduct[];
  logo?: StoreLogo | null;
  subdomain: string;
  currency?: string;
  /** False when the merchant cannot take payment yet — the cart says so plainly. */
  canSell?: boolean;
}) {
  const fontsHref = googleFontsUrl(ds);
  // A hero image lifts the split/fullbleed heroes; use the first product photo.
  const heroImage = catalog.find((p) => p.image_url)?.image_url ?? null;
  // Base path for internal store links: on localhost the store lives under
  // /store/{sub}; on a real subdomain it lives at the root.
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  const storeBase = rootDomain.startsWith("localhost") ? `/store/${subdomain}` : "";

  /*
   * Navigation is derived from the page that is about to be rendered, so a link
   * can never point at a section that isn't there. Both engines are considered:
   * the authored narrative may carry a story beat, and a legacy store may have
   * one in its section order.
   */
  const hasStory = ds.narrative?.length
    ? ds.narrative.some((b) => b.kind === "story")
    : ds.layout.sectionOrder.includes("story") && Boolean(ds.story?.trim());
  const navLinks: NavLink[] = [
    ...(catalog.length ? [{ label: "Shop", href: "#uv-shop" }] : []),
    ...(hasStory ? [{ label: "Story", href: "#uv-story" }] : []),
  ];

  const render = (key: SectionKey) => {
    switch (key) {
      case "announcement": return <Announcement key={key} ds={ds} />;
      case "hero": return <Hero key={key} storeName={storeName} ds={ds} heroImage={heroImage} logo={logo} storyHref={hasStory ? "#uv-story" : null} />;
      case "marquee": return <Marquee key={key} ds={ds} storeName={storeName} />;
      case "trust": return <Trust key={key} ds={ds} />;
      case "collection": return <Collection key={key} ds={ds} catalog={catalog} logo={logo} storeBase={storeBase} />;
      case "story": return <Story key={key} ds={ds} storeName={storeName} />;
      case "highlights": return <Highlights key={key} ds={ds} />;
      case "newsletter": return <Newsletter key={key} ds={ds} storeName={storeName} subdomain={subdomain} />;
      case "footer": return <Footer key={key} ds={ds} storeName={storeName} catalog={catalog} storeBase={storeBase} links={navLinks} />;
      default: return null;
    }
  };

  // New engine: the AI-authored emotional journey. Legacy stores (no narrative)
  // still render through the original fixed-section order.
  const narrative = ds.narrative;
  let content: React.ReactNode;
  if (narrative && narrative.length) {
    const ctx: NarrativeCtx = { ds, storeName, catalog, storeBase, logo, heroImage, subdomain };
    // The narrative never includes the footer — it's the fixed shell close.
    content = (
      <>
        {narrative.map((block, i) => renderBlock(block, i, ctx))}
        <Footer ds={ds} storeName={storeName} catalog={catalog} storeBase={storeBase} links={navLinks} />
      </>
    );
  } else {
    // Legacy: the fixed section order already carries its own footer.
    const order = ds.layout.sectionOrder;
    content = order.filter((k) => k !== "announcement").map(render);
  }

  return (
    <>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <style dangerouslySetInnerHTML={{ __html: scopedCss(ds) }} />
      <div id="uv-store" style={buildVars(ds)}>
        <StoreCartProvider subdomain={subdomain} currency={currency} canSell={canSell}>
          {ds.layout.announcement && <Announcement ds={ds} />}
          <Nav storeName={storeName} ds={ds} links={navLinks} />
          {content}
        </StoreCartProvider>
      </div>
    </>
  );
}
