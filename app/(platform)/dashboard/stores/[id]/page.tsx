import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { getPlanForUser } from "@/lib/plan-access";
import { parseTheme } from "@/lib/storefront";
import { parseLogo } from "@/lib/storefront/design-system";
import { auditStoreSeo } from "@/lib/seo";
import { SeoCard } from "./seo-card";
import { env } from "@/lib/env";
import { StoreManager } from "./store-manager";
import { gpsrFormFrom } from "@/lib/commerce/gpsr";

export const dynamic = "force-dynamic";

function storeUrl(subdomain: string): string {
  const { ROOT_DOMAIN, NODE_ENV } = env();
  if (NODE_ENV !== "production" || ROOT_DOMAIN.startsWith("localhost")) {
    return `/store/${subdomain}`;
  }
  return `https://${subdomain}.${ROOT_DOMAIN}`;
}

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: store } = await supabase
    .from("stores")
    .select("id, user_id, store_name, subdomain, is_active, theme_config")
    .eq("id", id)
    .maybeSingle();

  if (!store || store.user_id !== user.id) notFound();

  const [{ data: products }, { data: profile }, plan] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, description, price_eur, inventory_count, image_url")
      .eq("store_id", id)
      .order("position", { ascending: true }),
    supabase.from("profiles").select("email").eq("id", user.id).single(),
    getPlanForUser(user.id),
  ]);

  const canPublish = plan.features.publish;
  const theme = parseTheme(store.theme_config);

  return (
    <>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Storefront</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">{store.store_name}</h1>
          <p className="mt-1.5 font-mono text-xs text-mist-dim">{store.subdomain}.urivo.ai</p>
        </div>
        <div className="flex items-center gap-2.5 self-start">
          <Link
            href={`/dashboard/stores/${store.id}/orders`}
            className="u-lift rounded-xl border border-hair bg-panel px-5 py-2.5 text-sm font-semibold text-ivory transition-colors hover:border-hair-strong hover:bg-panel-2"
          >
            Orders
          </Link>
          <a
            href={storeUrl(store.subdomain)}
            target="_blank"
            rel="noreferrer"
            className="u-lift rounded-xl border border-hair bg-panel px-5 py-2.5 text-sm font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2"
          >
            {store.is_active ? "View live" : "Preview"}
          </a>
        </div>
      </header>

      {/*
        PAUSED banner — the dashboard side of the same derived rule the public
        storefront uses (store_is_paused): a published store whose owner has
        lapsed to free entitlement. Keyed on the ENTITLED plan (plan.key), which
        matches the definer helper exactly, not on the movable free-publish
        policy. The merchant keeps full access to the store, products and orders
        below; only public selling is off. Reactivation is the existing billing
        flow — no subscription state is mutated from the browser.
      */}
      {store.is_active && plan.key === "free" && (
        <div className="u-float mt-6 rounded-2xl border border-gold/25 bg-gold/[0.05] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-soft">Store paused</p>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ivory">
                Your subscription ended, so this store is paused — visitors see a maintenance page and
                checkout is off. Your store, products and orders are all safe and still here.
              </p>
              <p className="mt-1 text-[13px] text-mist">Reactivate to bring it back live.</p>
            </div>
            <Link
              href="/dashboard/billing"
              className="u-gold u-lift shrink-0 rounded-xl px-5 py-2.5 text-center text-sm font-semibold"
            >
              Reactivate store
            </Link>
          </div>
        </div>
      )}

      <StoreManager
        storeId={store.id}
        canPublish={canPublish}
        initialProducts={(products ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          priceEUR: Number(p.price_eur),
          inventoryCount: p.inventory_count,
          imageUrl: p.image_url ?? null,
          showLogo: (p as { show_logo?: boolean }).show_logo ?? true,
          // GPSR (0050). Read through a cast so an un-migrated environment shows
          // empty fields rather than failing the whole catalogue to load.
          ...gpsrFormFrom(p as Record<string, unknown>),
        }))}
        initialLogo={parseLogo(store.theme_config)}
        initialTheme={{
          storeName: store.store_name,
          tagline: theme.tagline,
          background: theme.background,
          structure: theme.structure,
          accent: theme.accent,
          isActive: store.is_active,
        }}
      />

      <SeoCard
        audit={auditStoreSeo({
          storeName: store.store_name,
          tagline: theme.tagline,
          products: (products ?? []).map((p) => ({
            title: p.title,
            description: p.description,
            price_eur: p.price_eur,
            image_url: p.image_url ?? null,
          })),
        })}
      />
    </>
  );
}
