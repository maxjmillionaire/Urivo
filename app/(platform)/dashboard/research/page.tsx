import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import { ResearchLab } from "./research-lab";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
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
    <AppShell active="research" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Market research</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Find the wedge, then the winners</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">
          Describe a niche or an idea. Urivo reads the market, the audience and the gaps, and proposes the products worth
          launching — each one ready to become a store.
        </p>
      </header>
      <ResearchLab />
    </AppShell>
  );
}
