import Link from "next/link";
import { PLANS, monthlyPrice } from "@/lib/plans";
import { CREDIT_PACKS } from "@/lib/credit-packs";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { CreditPacks } from "./billing/credit-packs";

/*
 * The out-of-credits moment. Calm and helpful, not punishing (peak-end rule) —
 * it appears exactly when someone tries to build with an empty balance.
 *
 * Two honest paths, subscription first (the better long-term value, made the
 * visual hero), a one-time top-up second. The closing line states the true
 * contrast — Founder gives 200 credits every month for what the Scale pack
 * costs once — nudging toward the subscription without a single dark pattern.
 */
export function OutOfCredits({ showHeader = true }: { showHeader?: boolean }) {
  const founder = PLANS.core;
  const founderPrice = monthlyPrice("core");

  return (
    <div className="mt-2">
      {showHeader && (
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-soft">Out of credits</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-ivory">Keep building — two ways forward</h3>
          <p className="mt-1.5 text-sm text-mist">Each store costs {CREDIT_COSTS.storeGeneration} credits. Pick what fits.</p>
        </div>
      )}

      {/* Hero — the subscription */}
      <div className="u-float mt-6 rounded-2xl border border-gold/30 bg-gold/[0.05] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Recommended</p>
            <p className="mt-1.5 text-[15px] font-semibold text-ivory">
              Upgrade to {founder.name} — €{founderPrice}/mo
            </p>
            <p className="mt-1 text-sm text-mist">
              {founder.monthlyCredits} credits every month, the AI Store Assistant, and stores you can publish.
            </p>
          </div>
          <Link
            href="/dashboard/billing"
            className="u-gold u-lift shrink-0 rounded-xl px-6 py-3 text-center text-sm font-semibold"
          >
            Upgrade
          </Link>
        </div>
      </div>

      {/* Secondary — one-time top-up */}
      <div className="mt-6">
        <p className="text-center text-sm text-mist">Just need a quick top-up?</p>
        <div className="mt-4">
          <CreditPacks compact />
        </div>
        <p className="mx-auto mt-4 max-w-md text-center text-[11px] leading-relaxed text-mist-dim">
          One-time, no subscription. For context: {founder.name} gives you {founder.monthlyCredits} credits{" "}
          <em>every month</em> — what the {CREDIT_PACKS.scale.name} pack ({CREDIT_PACKS.scale.credits} credits) costs
          just once.
        </p>
      </div>
    </div>
  );
}
