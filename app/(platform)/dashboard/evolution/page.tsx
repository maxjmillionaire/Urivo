import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getPlan } from "@/lib/plans";
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
    supabase.from("profiles").select("email, plan").eq("id", user.id).single(),
    loadRailStore(user.id),
  ]);

  const plan = getPlan(profile?.plan);
  const evolution = plan.features.evolution;

  return (
    <AppShell active="evolution" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Evolution Lab</p>
          {evolution === "advanced" && (
            <span className="rounded-full border border-gold/25 bg-gold/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-soft">
              Advanced
            </span>
          )}
        </div>
        <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight text-ivory">
          Watch intelligence evolve your store.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
          Urivo doesn&apos;t generate one store — it generates a hundred, scores every one, and lets
          them evolve across generations until only the highest-performing storefront remains.
        </p>
      </header>

      {evolution === "none" ? (
        <div className="u-float mt-8 overflow-hidden rounded-2xl border border-hair bg-panel/70">
          <div className="relative border-b border-hair px-8 py-12 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(60% 80% at 50% 0%, rgba(232,205,128,0.10), rgba(11,18,32,0) 60%)" }}
            />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-soft">
              Founder &amp; Pro
            </p>
            <h2 className="relative mx-auto mt-3 max-w-lg text-[22px] font-semibold leading-snug tracking-tight text-ivory">
              The Evolution Lab breeds a hundred storefronts and keeps only the winner.
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-mist">
              Upgrade to run evolution on any idea. Pro unlocks Advanced Evolution with the
              winning store&apos;s full seven-signal fitness breakdown.
            </p>
            <Link
              href="/dashboard/billing"
              className="u-gold u-lift relative mt-6 inline-flex rounded-xl px-6 py-3 text-sm font-semibold"
            >
              See plans
            </Link>
          </div>
        </div>
      ) : (
        <EvolutionLab tier={evolution} />
      )}
    </AppShell>
  );
}
