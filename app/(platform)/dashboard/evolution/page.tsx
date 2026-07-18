import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import { EvolutionLab } from "./evolution-lab";

export const dynamic = "force-dynamic";

export const metadata = { title: "Evolution Lab — Urivo" };

export default async function EvolutionPage() {
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
    <AppShell active="evolution" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Evolution Lab</p>
        </div>
        <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight text-ivory">
          Watch intelligence evolve your store.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
          Urivo doesn&apos;t generate one store — it generates a hundred, scores every one, and lets
          them evolve across generations until only the highest-performing storefront remains.
        </p>
      </header>

      <EvolutionLab />
    </AppShell>
  );
}
