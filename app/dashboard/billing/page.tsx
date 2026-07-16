import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditBalance, getCreditLedger } from "@/lib/credits";
import { UpgradeButton } from "./upgrade-buttons";

export const dynamic = "force-dynamic";

const LAUNCH_START = new Date("2026-07-23T00:00:00Z");
const LAUNCH_END = new Date("2026-08-15T23:59:59Z");
function isLaunchWindow(now = new Date()): boolean {
  return now >= LAUNCH_START && now <= LAUNCH_END;
}

export default async function BillingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, balance, ledger] = await Promise.all([
    supabase.from("profiles").select("plan, price_type, subscription_status").eq("id", user.id).single(),
    getCreditBalance(user.id),
    getCreditLedger(user.id),
  ]);

  const plan = profile?.plan ?? "free";
  const launch = isLaunchWindow();
  const planLabel = plan === "core" ? "Core" : plan === "pro" ? "Pro" : "Free";

  const priceOrigin =
    profile?.price_type === "launch"
      ? "Founder pricing — locked for the life of your subscription"
      : profile?.price_type === "creator"
        ? "Creator pricing for your first three months"
        : "Standard pricing";

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-16">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50 transition-colors hover:text-ivory-100"
        >
          ← Workspace
        </Link>
      </div>

      <header className="border-b border-ivory-100/10 pb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
          Billing
        </p>
        <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100">
          Plan &amp; credits
        </h1>
      </header>

      {/* Current plan + credits */}
      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-ivory-100/10 bg-ivory-100/5 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Current plan
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-ivory-100">{planLabel}</p>
          <p className="mt-2 text-xs font-light text-ivory-100/50">{priceOrigin}</p>
        </div>
        <div className="rounded-2xl border border-gold-500/20 bg-forest-950 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Credits
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-gold-300">{balance}</p>
          <p className="mt-2 text-xs font-light text-ivory-100/50">Each store costs 10 credits</p>
        </div>
      </section>

      {/* Upgrade (Free plan only) */}
      {plan === "free" && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl font-normal text-ivory-100">Upgrade</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-gold-500/40 bg-ivory-100/5 p-8">
              <h3 className="font-serif text-2xl text-ivory-100">Core</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-serif text-4xl font-light text-ivory-100">
                  {launch ? "€49" : "€79"}
                </span>
                {launch && <span className="text-ivory-100/40 line-through">€79</span>}
                <span className="text-sm text-ivory-100/50">/ mo</span>
              </div>
              <p className="mt-6 flex-1 text-sm font-light text-ivory-100/60">
                Monthly credits, multiple storefronts, unlimited products, analytics.
              </p>
              <div className="mt-6">
                <UpgradeButton plan="core" label="Choose Core" highlight />
              </div>
            </div>
            <div className="flex flex-col rounded-2xl border border-ivory-100/10 bg-ivory-100/[0.03] p-8">
              <h3 className="font-serif text-2xl text-ivory-100">Pro</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-serif text-4xl font-light text-ivory-100">
                  {launch ? "€199" : "€299"}
                </span>
                {launch && <span className="text-ivory-100/40 line-through">€299</span>}
                <span className="text-sm text-ivory-100/50">/ mo</span>
              </div>
              <p className="mt-6 flex-1 text-sm font-light text-ivory-100/60">
                Higher credit allowance, custom domains, priority generation.
              </p>
              <div className="mt-6">
                <UpgradeButton plan="pro" label="Choose Pro" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Credit ledger */}
      <section className="mt-12">
        <h2 className="font-serif text-2xl font-normal text-ivory-100">Credit history</h2>
        {ledger.length === 0 ? (
          <p className="mt-6 text-sm font-light text-ivory-100/50">No credit activity yet.</p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-ivory-100/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-ivory-100/5 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50">
                  <th className="px-6 py-4">Reason</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ivory-100/5">
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="px-6 py-4 font-light text-ivory-100/80">{e.reason}</td>
                    <td className="px-6 py-4 font-light text-ivory-100/50">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-mono ${
                        e.delta > 0 ? "text-success-dark" : "text-ivory-100/70"
                      }`}
                    >
                      {e.delta > 0 ? `+${e.delta}` : e.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
