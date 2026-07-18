import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import { AdStudio } from "./ad-studio";

export const dynamic = "force-dynamic";

export default async function AdsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, rail] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", user.id).single(),
    loadRailStore(user.id),
  ]);

  return (
    <AppShell active="ads" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Ad Studio</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Ads, ready to run</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">
          A channel strategy and platform-ready creative for your store — grounded in its brand, voice and products.
        </p>
      </header>
      <AdStudio store={rail ? { id: rail.id, name: rail.name } : null} />
    </AppShell>
  );
}
