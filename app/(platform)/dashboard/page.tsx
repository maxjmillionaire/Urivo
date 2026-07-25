import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { AppShell } from "./_shell/app-shell";
import { DashboardHome } from "./_shell/dashboard-home";
import type { RailStore } from "./_shell/app-rail";
import { sendWelcomeIfFirstTime } from "@/lib/email/welcome";
import { reconcilePendingReferral } from "@/lib/referral/service";
import { buildDashboardOverview } from "@/lib/dashboard/overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: storeRows }] = await Promise.all([
    supabase.from("profiles").select("email, full_name").eq("id", user.id).single(),
    supabase
      .from("stores")
      .select("id, store_name, subdomain, is_active, theme_config, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const stores = storeRows ?? [];

  // Companion rail — the loud, living object (the top store) lives on the right.
  let rail: RailStore | null = null;
  if (stores.length) {
    const top = stores.find((s) => s.is_active) ?? stores[0];
    const theme = parseTheme(top.theme_config);
    const { data: topProducts } = await supabase
      .from("products")
      .select("title, price_eur")
      .eq("store_id", top.id)
      .order("position", { ascending: true })
      .limit(4);
    rail = {
      id: top.id,
      name: top.store_name,
      subdomain: top.subdomain,
      tagline: theme.tagline,
      isLive: top.is_active,
      palette: { background: theme.background, structure: theme.structure, accent: theme.accent },
      products: (topProducts ?? []).map((p) => ({ title: p.title, priceEUR: Number(p.price_eur) })),
    };
  }

  // The Executive Command Center — every number, briefing and recommendation
  // from real tables (orders, storefront visits, catalogue, AI ledger, credits).
  const overview = await buildDashboardOverview(user.id, profile?.full_name ?? null);

  // First dashboard visit → one-time welcome email (best-effort).
  await sendWelcomeIfFirstTime(user.id, profile?.email ?? user.email ?? null, profile?.full_name ?? null);
  // Attribute a creator code entered at signup (first-touch). Best-effort.
  await reconcilePendingReferral(user.id, user.user_metadata);

  return (
    <AppShell active="home" email={profile?.email ?? user.email ?? null} store={rail}>
      <DashboardHome overview={overview} />
    </AppShell>
  );
}
