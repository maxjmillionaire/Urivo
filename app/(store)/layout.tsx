/*
 * Layout for GENERATED MERCHANT STOREFRONTS.
 *
 * Intentionally a bare pass-through: the neutral root layout supplies a plain
 * <html lang="en"><body> with NO classes, and this adds nothing on top — no
 * Urivo brand, no Urivo fonts, no consent banner, no theme. Each store owns its
 * entire design system and paints its own canvas via the renderer; the per-store
 * mobile theme-colour is set by the store page's generateViewport. This
 * guarantees, by construction, that Urivo's chrome can never leak into a
 * customer-facing store.
 */
export default function StoreLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
