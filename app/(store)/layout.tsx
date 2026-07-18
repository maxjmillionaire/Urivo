import "@/app/globals.css";

/*
 * Root layout for GENERATED MERCHANT STOREFRONTS.
 *
 * Intentionally bare: no Urivo brand, no Urivo fonts, no consent banner, no
 * theme. Each store owns its entire design system (colour, type, shape, motion)
 * and paints its own canvas via the renderer. Urivo appears only as a quiet
 * footer credit. The per-store mobile theme-colour is set by the store page's
 * generateViewport. This guarantees, by construction, that Urivo's chrome can
 * never leak into a customer-facing store.
 */
export default function StoreLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
