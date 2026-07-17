import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { env } from "@/lib/env";
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

  // Ownership check — not-owned is indistinguishable from not-found.
  if (!store || store.user_id !== user.id) notFound();

  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, price_eur, inventory_count")
    .eq("store_id", id)
    .order("position", { ascending: true });

  const theme = parseTheme(store.theme_config);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          ← Workspace
        </Link>
      </div>

      <header className="flex flex-col gap-6 border-b border-line pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Storefront
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
            {store.store_name}
          </h1>
          <p className="mt-2 font-mono text-xs text-muted">
            {store.subdomain}.urivo.ai
          </p>
        </div>
        <a
          href={storeUrl(store.subdomain)}
          target="_blank"
          rel="noreferrer"
          className="self-start rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-surface-muted"
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
    </main>
  );
}
