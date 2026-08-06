import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditBalance, getCreditLedger } from "@/lib/credits";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import { ManageSubscriptionButton } from "./upgrade-buttons";
import { PlanPicker } from "./plan-picker";
import { CreditPacks } from "./credit-packs";
import { PayoutSetup } from "./payouts";
import { getConnectStatus, connectState } from "@/lib/billing/connect";
import { PLANS, planName, formatPrice, isLaunchWindow, priceForUser } from "@/lib/plans";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { RevealStagger } from "../../_motion/reveal-stagger";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, balance, ledger, rail, connect] = await Promise.all([
    supabase.from("profiles").select("plan, price_type, subscription_status, email").eq("id", user.id).single(),
    getCreditBalance(user.id),
    getCreditLedger(user.id),
    loadRailStore(user.id),
    getConnectStatus(user.id),
  ]);

  const plan = profile?.plan ?? "free";
  const priceType = profile?.price_type ?? "standard";
  const isFoundingMember = priceType === "founding";
  const launch = isLaunchWindow();
  const planLabel = planName(plan);
  const priceOrigin =
    isFoundingMember
      ? "Founding member — lifetime price, locked forever"
      : profile?.price_type === "launch"
        ? "Founder pricing — locked for the life of your subscription"
        : profile?.price_type === "creator"
          ? "Creator pricing for your first three months"
          : "Standard pricing";

  return (
    <AppShell active="billing" email={profile?.email ?? user.email ?? null} store={rail}>
      <RevealStagger>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Billing</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Plan &amp; credits</h1>
      </header>

      <section className="mt-7 grid gap-4 sm:grid-cols-2">
        <div className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Current plan</p>
          <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight text-ivory">{planLabel}</p>
          <p className="mt-3 text-xs text-mist-dim">{priceOrigin}</p>
        </div>
        <div className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Credits</p>
          </div>
          <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight u-gold-text tabular-nums">{balance}</p>
          <p className="mt-3 text-xs text-mist-dim">Each store costs {CREDIT_COSTS.storeGeneration} credits</p>
        </div>
      </section>

      {/* Payouts matter once a merchant can publish and sell. */}
      {plan !== "free" && (
        <section className="mt-4">
          <PayoutSetup state={connectState(connect)} />
        </section>
      )}

      {/* Shown to Founder too, not just Free — a Founder who never sees Pro on
          their own billing page can only find it through the Stripe portal. */}
      {plan !== "pro" && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight text-ivory">
            {plan === "free" ? "Upgrade" : "Move up to Pro"}
          </h2>
          <p className="mt-1 text-sm text-mist">
            From your idea to a live store in minutes.
            {isFoundingMember && " You're a founding member — your price is locked for life."}
          </p>
          <PlanPicker priceType={priceType} isFoundingMember={isFoundingMember} launch={launch} currentPlan={plan} />
        </section>
      )}

      {plan !== "free" && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight text-ivory">Manage subscription</h2>
          <div className="u-float mt-4 flex flex-col gap-4 rounded-2xl border border-hair bg-panel/70 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-ivory">
                Update your payment method, change plan, or cancel anytime.
              </p>
              <p className="mt-1 text-xs text-mist">
                {profile?.subscription_status === "canceled"
                  ? "Your subscription is set to end — you keep access until the period closes."
                  : "You're in control. Cancelling stays effective until the end of your paid period."}
              </p>
            </div>
            <ManageSubscriptionButton />
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-ivory">Buy credits</h2>
          <p className="text-xs text-mist">One-time top-ups · no subscription</p>
        </div>
        <div className="mt-5">
          <CreditPacks />
        </div>
        {plan === "free" && (
          <p className="mx-auto mt-4 max-w-lg text-center text-xs leading-relaxed text-mist-dim">
            Top-ups are handy in a pinch — but a plan is the better deal: Founder gives you{" "}
            {PLANS.core.monthlyCredits} credits every month for less per credit than any pack.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-ivory">Credit history</h2>
        {ledger.length === 0 ? (
          <div className="u-float mt-4 rounded-2xl border border-dashed border-hair-strong bg-panel/40 p-10 text-center">
            <p className="text-sm text-ivory">No credit activity yet</p>
            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-mist">
              Your welcome credits and every store you generate will show up here.
            </p>
          </div>
        ) : (
          <div className="u-float mt-4 overflow-hidden rounded-2xl border border-hair bg-panel/70">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hair bg-white/[0.02] text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">
                  <th className="px-6 py-4">Reason</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {ledger.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-6 py-4 text-ivory">{e.reason}</td>
                    <td className="px-6 py-4 text-mist">{new Date(e.createdAt).toLocaleDateString()}</td>
                    <td className={`px-6 py-4 text-right font-mono ${e.delta > 0 ? "text-live" : "text-mist"}`}>
                      {e.delta > 0 ? `+${e.delta}` : e.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </RevealStagger>
    </AppShell>
  );
}
