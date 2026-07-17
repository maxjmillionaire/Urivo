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
          className="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          ← Workspace
        </Link>
      </div>

      <header className="border-b border-line pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Billing
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
          Plan &amp; credits
        </h1>
      </header>

      {/* Current plan + credits */}
      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Current plan
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-ink">{planLabel}</p>
          <p className="mt-2 text-xs text-muted">{priceOrigin}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Credits
            </p>
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-brand tabular-nums">{balance}</p>
          <p className="mt-2 text-xs text-muted">Each store costs 10 credits</p>
        </div>
      </section>

      {/* Upgrade (Free plan only) */}
      {plan === "free" && (
        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Upgrade</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col rounded-lg border border-brand bg-surface p-8 shadow-soft ring-1 ring-brand/10">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-semibold text-ink">Core</h3>
                <span className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-ink">
                  {launch ? "€49" : "€79"}
                </span>
                {launch && <span className="text-muted line-through">€79</span>}
                <span className="text-sm text-muted">/ mo</span>
              </div>
              <p className="mt-6 flex-1 text-sm leading-relaxed text-muted">
                Monthly credits, multiple storefronts, unlimited products, analytics.
              </p>
              <div className="mt-6">
                <UpgradeButton plan="core" label="Choose Core" highlight />
              </div>
            </div>
            <div className="flex flex-col rounded-lg border border-line bg-surface p-8 shadow-soft">
              <h3 className="text-2xl font-semibold text-ink">Pro</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-ink">
                  {launch ? "€199" : "€299"}
                </span>
                {launch && <span className="text-muted line-through">€299</span>}
                <span className="text-sm text-muted">/ mo</span>
              </div>
              <p className="mt-6 flex-1 text-sm leading-relaxed text-muted">
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
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Credit history</h2>
        {ledger.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No credit activity yet.</p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-6 py-4">Reason</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="px-6 py-4 text-ink">{e.reason}</td>
                    <td className="px-6 py-4 text-muted">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-mono ${
                        e.delta > 0 ? "text-[#15803d]" : "text-muted"
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
