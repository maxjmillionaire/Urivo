import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { env } from "@/lib/env";
import { AppShell } from "../../_shell/app-shell";
import { loadRailStore } from "../../_shell/rail-data";
import { StoreManager } from "./store-manager";

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

  const [{ data: products }, { data: profile }, rail] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, description, price_eur, inventory_count")
      .eq("store_id", id)
      .order("position", { ascending: true }),
    supabase.from("profiles").select("email").eq("id", user.id).single(),
    loadRailStore(user.id),
  ]);

  const theme = parseTheme(store.theme_config);

  return (
    <AppShell active="stores" email={profile?.email ?? user.email ?? null} store={rail}>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Storefront</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">{store.store_name}</h1>
          <p className="mt-1.5 font-mono text-xs text-mist-dim">{store.subdomain}.urivo.ai</p>
        </div>
        <a
          href={storeUrl(store.subdomain)}
          target="_blank"
          rel="noreferrer"
          className="u-lift self-start rounded-xl border border-hair bg-panel px-5 py-2.5 text-sm font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2"
        >
          View live
        </a>
      </header>

      <StoreManager
        storeId={store.id}
        initialProducts={(products ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          priceEUR: Number(p.price_eur),
          inventoryCount: p.inventory_count,
        }))}
        initialTheme={{
          storeName: store.store_name,
          tagline: theme.tagline,
          background: theme.background,
          structure: theme.structure,
          accent: theme.accent,
          isActive: store.is_active,
        }}
      />
    </AppShell>
  );
}
