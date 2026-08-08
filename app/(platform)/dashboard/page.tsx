import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { DashboardHome } from "./_shell/dashboard-home";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", user.id)
    .single();

  /*
   * The companion rail belongs to the layout now, which loads it once for every
   * screen. This page used to assemble its own copy — a stores query and a
   * products query on the busiest route in the product, both of which the
   * layout was already making. Removing them takes two round-trips off the
   * dashboard's first paint; buildDashboardOverview below reads what it needs.
   */

  // The Executive Command Center — every number, briefing and recommendation
  // from real tables (orders, storefront visits, catalogue, AI ledger, credits).
  const overview = await buildDashboardOverview(user.id, profile?.full_name ?? null);

  // First dashboard visit → one-time welcome email (best-effort).
  await sendWelcomeIfFirstTime(user.id, profile?.email ?? user.email ?? null, profile?.full_name ?? null);
  // Attribute a creator code entered at signup (first-touch). Best-effort.
  await reconcilePendingReferral(user.id, user.user_metadata);

  return (
    <>
      <DashboardHome overview={overview} />
    </>
  );
}
