import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { StorefrontView } from "./storefront-view";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

interface Props {
  params: Promise<{ subdomain: string }>;
}

async function loadStore(subdomain: string) {
  if (!SUBDOMAIN_PATTERN.test(subdomain)) return null;
  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("id, store_name, theme_config")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .single();
  return store ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return { title: "Store not found" };
  const theme = parseTheme(store.theme_config);
  return {
    title: store.store_name,
    description: theme.tagline || `${store.store_name} — powered by Urivo.`,
  };
}

export default async function StorefrontPage({ params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();

  const supabase = await supabaseServer();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, price_eur")
    .eq("store_id", store.id)
    .order("position", { ascending: true });

  const theme = parseTheme(store.theme_config);

  return (
    <StorefrontView storeName={store.store_name} theme={theme} catalog={products ?? []} />
  );
}
