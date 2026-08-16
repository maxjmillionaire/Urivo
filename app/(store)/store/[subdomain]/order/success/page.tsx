import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem, fontStack } from "@/lib/storefront/design-system";
import { STOREFRONT_FONT_VARS } from "@/lib/storefront/fonts";
import { ClearCart } from "./clear-cart";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

/*
 * Order confirmation — rendered in the MERCHANT's brand (their palette, type
 * and shape), never Urivo's. Reached from Stripe's success_url after payment.
 * The Stripe webhook is the source of truth for the order itself; this page is
 * the calm, on-brand thank-you and it empties the shopper's cart.
 */
export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  if (!SUBDOMAIN_PATTERN.test(subdomain)) notFound();

  const supabase = await supabaseServer();
  /*
   * `storefronts`, not `stores` (migration 0054) — the buyer landing here is
   * usually anonymous and is never the merchant, and `stores` is now readable
   * only by its owner. Only the brand is needed to render the receipt.
   */
  const { data: store } = await supabase
    .from("storefronts")
    .select("store_name, theme_config")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .maybeSingle();
  if (!store) notFound();

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));
  const p = ds.palette;

  return (
    <main
      className={STOREFRONT_FONT_VARS}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.25rem",
        background: p.background,
        color: p.ink,
        fontFamily: fontStack(ds.fonts.bodyKey),
      }}
    >
      <ClearCart subdomain={subdomain} />
      <div
        style={{
          width: "100%",
          maxWidth: "30rem",
          textAlign: "center",
          background: p.surface,
          border: `1px solid ${p.line}`,
          borderRadius: `${ds.shape.radius}px`,
          padding: "clamp(2rem, 5vw, 3rem)",
          boxShadow: `0 40px 90px -50px ${p.ink}`,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: "3.25rem",
            height: "3.25rem",
            borderRadius: "999px",
            background: p.accent,
            color: p.accentInk,
            fontSize: "1.4rem",
          }}
        >
          ✓
        </span>
        <p style={{ marginTop: "1.4rem", fontSize: ".72rem", letterSpacing: ".24em", textTransform: "uppercase", color: p.muted }}>
          Order confirmed
        </p>
        <h1
          style={{
            marginTop: ".7rem",
            fontFamily: fontStack(ds.fonts.headingKey),
            fontSize: "clamp(1.8rem, 5vw, 2.4rem)",
            letterSpacing: `${ds.typeStyle.headingTracking}em`,
            lineHeight: 1.1,
          }}
        >
          Thank you
        </h1>
        <p style={{ marginTop: "1rem", color: p.muted, fontSize: ".98rem", lineHeight: 1.6 }}>
          Your order at <strong style={{ color: p.ink }}>{store.store_name}</strong> is confirmed. A receipt is on its way to
          your email — we can&apos;t wait for it to reach you.
        </p>
        <Link
          href={`/store/${subdomain}`}
          style={{
            display: "inline-block",
            marginTop: "1.8rem",
            padding: ".9rem 1.8rem",
            borderRadius: `${ds.shape.buttonShape === "pill" ? 999 : ds.shape.radius}px`,
            background: p.accent,
            color: p.accentInk,
            fontWeight: 700,
            fontSize: ".76rem",
            letterSpacing: ".14em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
