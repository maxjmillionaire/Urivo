import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditBalance } from "@/lib/credits";
import { env } from "@/lib/env";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

function storeUrl(subdomain: string): string {
  const { ROOT_DOMAIN, NODE_ENV } = env();
  if (NODE_ENV !== "production" || ROOT_DOMAIN.startsWith("localhost")) {
    return `/store/${subdomain}`;
  }
  return `https://${subdomain}.${ROOT_DOMAIN}`;
}

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, balance, { data: stores }] = await Promise.all([
    supabase.from("profiles").select("email, full_name, plan").eq("id", user.id).single(),
    getCreditBalance(user.id),
    supabase
      .from("stores")
      .select("id, store_name, subdomain, is_active, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const planLabel =
    profile?.plan === "core" ? "Core" : profile?.plan === "pro" ? "Pro" : "Free";

  return (
    <DashboardView
      fullName={profile?.full_name ?? null}
      email={profile?.email ?? user.email ?? null}
      planLabel={planLabel}
      balance={balance}
      stores={(stores ?? []).map((s) => ({
        id: s.id,
        storeName: s.store_name,
        subdomain: s.subdomain,
        isActive: s.is_active,
        url: storeUrl(s.subdomain),
      }))}
    />
  );
}
