import type { CSSProperties } from "react";
import type { StorefrontTheme } from "@/lib/storefront";

/*
 * Presentational storefront (data-agnostic), rendered entirely from the
 * merchant's own AI-generated palette + fonts — deliberately NOT the Urivo
 * brand. Editorial masthead, a considered product grid, quiet footer.
 */

export interface StorefrontProduct {
  id: string;
  title: string;
  description: string | null;
  price_eur: number | string;
}

/* ---- Colour math: derive a premium glossy CTA from a single brand accent ---- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix a hex toward a target rgb by amount (0–1). */
function mix(hex: string, target: [number, number, number], amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r + (target[0] - r) * amt, g + (target[1] - g) * amt, b + (target[2] - b) * amt);
}

/** Relative luminance (WCAG) — used to pick readable ink on the accent. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/** CSS custom properties that drive the shared `.u-cta-premium` finish. */
function ctaVars(accent: string): CSSProperties {
  const [r, g, b] = hexToRgb(accent);
  const ink = luminance(accent) > 0.52 ? mix(accent, BLACK, 0.82) : "#ffffff";
  return {
    ["--cta-hi" as string]: mix(accent, WHITE, 0.24),
    ["--cta-base" as string]: accent,
    ["--cta-lo" as string]: mix(accent, BLACK, 0.16),
    ["--cta-ink" as string]: ink,
    ["--cta-glow" as string]: `rgba(${r}, ${g}, ${b}, 0.5)`,
  } as CSSProperties;
}

export function StorefrontView({
  storeName,
  theme,
  catalog,
}: {
  storeName: string;
  theme: StorefrontTheme;
  catalog: StorefrontProduct[];
}) {
  const line = `${theme.structure}1F`; // ~12% structure for hairlines
  const faint = `${theme.structure}0D`;
  const cta = ctaVars(theme.accent);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: theme.background, color: theme.structure, fontFamily: theme.bodyFont }}
    >
      {/* Nav */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{ borderColor: line, backgroundColor: `${theme.background}CC` }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 sm:px-10">
          <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: theme.headingFont }}>
            {storeName}
          </span>
          <nav className="flex items-center gap-7 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
            <span>Shop</span>
            <span className="hidden sm:inline">About</span>
            <span className="u-cta-premium rounded-full px-3 py-1.5 text-[10px]" style={cta}>
              Cart · 0
            </span>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 sm:px-10">
        {/* Masthead */}
        <section className="border-b py-20 sm:py-28" style={{ borderColor: line }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] opacity-50">New collection</p>
          <h1
            className="mt-5 max-w-3xl text-5xl font-normal leading-[1.05] tracking-tight sm:text-7xl"
            style={{ fontFamily: theme.headingFont }}
          >
            {storeName}
          </h1>
          {theme.tagline && <p className="mt-6 max-w-xl text-lg italic opacity-70">{theme.tagline}</p>}
          <button
            className="u-cta-premium mt-9 rounded-full px-7 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] hover:-translate-y-0.5"
            style={cta}
          >
            Shop the collection
          </button>
        </section>

        {/* Collection */}
        <main className="py-16">
          {catalog.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-50">Opening soon</p>
              <p className="mt-4 text-2xl" style={{ fontFamily: theme.headingFont }}>
                The collection is being curated.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.25em] opacity-60">The collection</h2>
                <span className="text-[11px] uppercase tracking-[0.2em] opacity-40">{catalog.length} pieces</span>
              </div>
              <div className="mt-10 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.map((product, i) => (
                  <article key={product.id} className="group">
                    {/* image plane — palette-driven placeholder */}
                    <div
                      className="relative aspect-[4/5] overflow-hidden rounded-sm"
                      style={{
                        background: `linear-gradient(150deg, ${faint}, ${line})`,
                        border: `1px solid ${line}`,
                      }}
                    >
                      <div
                        className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                        style={{
                          background: `radial-gradient(120% 90% at 30% 20%, ${theme.accent}22, transparent 60%)`,
                        }}
                      />
                      <span
                        className="absolute left-4 top-4 text-[10px] font-semibold uppercase tracking-[0.2em] opacity-40"
                        style={{ fontFamily: theme.headingFont }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="mt-4 flex items-baseline justify-between gap-4">
                      <h3 className="text-lg leading-snug" style={{ fontFamily: theme.headingFont }}>
                        {product.title}
                      </h3>
                      <span className="shrink-0 text-base font-medium tabular-nums">
                        €{Number(product.price_eur).toFixed(2)}
                      </span>
                    </div>
                    {product.description && (
                      <p className="mt-2 text-sm leading-relaxed opacity-65">{product.description}</p>
                    )}
                    <button
                      className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70 transition-opacity hover:opacity-100"
                      style={{ borderBottom: `1px solid ${theme.accent}` }}
                    >
                      Add to cart
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: line }}>
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row sm:px-10">
          <span className="text-sm" style={{ fontFamily: theme.headingFont }}>
            {storeName}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.25em] opacity-40">Powered by Urivo</span>
        </div>
      </footer>
    </div>
  );
}
