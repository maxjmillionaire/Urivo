import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { entitledPlan } from "@/lib/plans";
import { EvolutionLab } from "./evolution-lab";

export const dynamic = "force-dynamic";

export const metadata = { title: "Evolution Lab — Urivo" };

export default async function EvolutionPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }] = await Promise.all([
    supabase
      .from("profiles")
      .select("email, plan, subscription_status, comped_until")
      .eq("id", user.id)
      .single(),
  ]);

  const plan = entitledPlan(profile);
  const evolution = plan.features.evolution;

  return (
    <>
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
        {/*
          * Says what it is, above the fold and before anyone pays.
          *
          * This read "Urivo doesn't generate one store — it generates a hundred,
          * scores every one, and lets them evolve across generations until only
          * the highest-performing storefront remains." The Lab itself is
          * labelled a simulation, but that label is INSIDE the paid feature: a
          * Free visitor read the promise, upgraded, and only then found out the
          * scores were a fitness model rather than live tests. The label has to
          * come before the money, not after it.
          *
          * The capability described here is the one that actually exists, and
          * it is genuinely useful — a hundred directions explored and ranked in
          * seconds, spending no traffic and no credits.
          */}
        <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight text-ivory">
          Explore a hundred versions of your store.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
          The Lab generates a hundred storefront directions, scores each one against Urivo&apos;s
          fitness model and evolves the strongest across generations — instantly, on no live
          traffic and no credits. The scores are a model of what converts, not measured conversion,
          so treat the winner as a strong starting direction rather than a proven result.
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
              Try a hundred directions for your store before you commit to one.
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-mist">
              The Lab scores a hundred generated storefronts against Urivo&apos;s fitness model and
              evolves the strongest — in seconds, on no live traffic and no credits. Pro adds the
              winner&apos;s full signal breakdown.
            </p>
            <p className="relative mx-auto mt-3 max-w-md text-xs leading-relaxed text-mist-dim">
              A design exploration, not a live A/B test — the scores model what tends to convert
              rather than measuring your own traffic.
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
    </>
  );
}
