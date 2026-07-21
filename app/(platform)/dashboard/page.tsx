import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditBalance } from "@/lib/credits";
import { parseTheme } from "@/lib/storefront";
import { planName, canPublish as planCanPublish } from "@/lib/plans";
import { AppShell } from "./_shell/app-shell";
import { DashboardHome } from "./_shell/dashboard-home";
import type { RailStore } from "./_shell/app-rail";
import { sendWelcomeIfFirstTime } from "@/lib/email/welcome";
import { reconcilePendingReferral } from "@/lib/referral/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, balance, { data: storeRows }] = await Promise.all([
    supabase.from("profiles").select("email, full_name, plan").eq("id", user.id).single(),
    getCreditBalance(user.id),
    supabase
      .from("stores")
      .select("id, store_name, subdomain, is_active, theme_config, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const stores = storeRows ?? [];
  const storeIds = stores.map((s) => s.id);

  let productCount = 0;
  let rail: RailStore | null = null;

  if (storeIds.length) {
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("store_id", storeIds);
    productCount = count ?? 0;

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

  // First dashboard visit → send the one-time welcome email (best-effort).
  await sendWelcomeIfFirstTime(user.id, profile?.email ?? user.email ?? null, profile?.full_name ?? null);

  // Attribute a creator code entered at signup (first-touch, validated, then
  // cleared). Runs here so it survives email confirmation / OAuth. Best-effort.
  await reconcilePendingReferral(user.id, user.user_metadata);

  const plan = profile?.plan ?? "free";
  const planLabel = planName(plan);

  return (
    <AppShell active="home" email={profile?.email ?? user.email ?? null} store={rail}>
      <DashboardHome
        fullName={profile?.full_name ?? null}
        credits={balance}
        planLabel={planLabel}
        hasPlan={plan === "core" || plan === "pro"}
        liveStores={stores.filter((s) => s.is_active).length}
        productCount={productCount}
        canGenerate={(balance ?? 0) >= 10}
        canPublish={planCanPublish(plan)}
        stores={stores.map((s) => ({
          id: s.id,
          name: s.store_name,
          subdomain: s.subdomain,
          isLive: s.is_active,
        }))}
      />
    </AppShell>
  );
}
