import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getReferralSnapshot } from "@/lib/referral/reporting";
import { isLaunchWindow } from "@/lib/plans";
import { CREATOR_COMMISSION_RATE, CREATOR_DISCOUNT_RATE } from "@/lib/referral/codes";
import { CreateCreatorForm } from "./create-creator-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Referrals · Urivo (internal)",
  robots: { index: false, follow: false },
};

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n || 0);
const int = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n || 0));
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

export default async function ReferralsDashboardPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  const { overview, topCreators } = await getReferralSnapshot();
  const launch = isLaunchWindow();

  return (
    <main className="min-h-screen bg-[#0b1220] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Internal · Affiliate</p>
            <h1 className="mt-1 text-3xl font-semibold">Creator referrals</h1>
            <p className="mt-1 text-sm text-white/50">
              Attribution + commission tracking · codes, not links
            </p>
          </div>
          <Link href="/admin/finance" className="text-sm text-amber-300/90 hover:text-amber-200">
            → Finance dashboard
          </Link>
        </header>

        {/* Active rules — makes the current phase unambiguous */}
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
          <span className="font-medium text-white">Current rules:</span>{" "}
          {launch ? (
            <>
              Launch offer is <strong className="text-amber-300">active</strong> — codes give{" "}
              <strong>no extra discount</strong> (customer already has the launch price), attribution +{" "}
              {int(CREATOR_COMMISSION_RATE * 100)}% commission still tracked.
            </>
          ) : (
            <>
              Post-launch — codes give <strong>{int(CREATOR_DISCOUNT_RATE * 100)}% off the first purchase</strong>,
              creator earns <strong>{int(CREATOR_COMMISSION_RATE * 100)}% on the first payment</strong> (once, no
              recurring).
            </>
          )}
        </div>

        {/* Overview KPIs */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="Creators" value={int(overview.totalCreators)} sub={`${int(overview.activeCreators)} active`} accent />
          <Tile label="Referred customers" value={int(overview.totalReferrals)} />
          <Tile label="First payments" value={int(overview.firstPayments)} sub={`${pct(overview.conversionPct)} conversion`} />
          <Tile label="Referral revenue" value={eur(overview.referralRevenueEur)} sub="first payments" />
          <Tile label="Commissions owed" value={eur(overview.commissionsOwedEur)} sub="to pay out" />
          <Tile label="Commissions paid" value={eur(overview.commissionsPaidEur)} />
        </section>

        {overview.firstPayments === 0 && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200/90">
            First-payment and commission figures populate once Stripe reports payments (Phase 2). Creators,
            codes and attribution work now — the same records plug straight into Stripe later.
          </p>
        )}

        {/* Onboard a creator */}
        <Section title="Add a creator" subtitle="Issues a unique referral code, ready for checkout">
          <CreateCreatorForm />
        </Section>

        {/* Leaderboard */}
        <Section title="Top creators" subtitle="Ranked by first payments, then referred customers">
          {topCreators.length === 0 ? (
            <Empty>No creators yet. Add your first above.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase tracking-wide text-white/45">
                    <th className="px-4 py-2.5 font-medium">Creator</th>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 text-right font-medium">Customers</th>
                    <th className="px-4 py-2.5 text-right font-medium">First payments</th>
                    <th className="px-4 py-2.5 text-right font-medium">Owed</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {topCreators.map((c) => (
                    <tr key={c.creatorId} className="border-b border-white/[0.06] last:border-0">
                      <td className="px-4 py-2.5 text-white/90">{c.name}</td>
                      <td className="px-4 py-2.5 font-mono uppercase tracking-wide text-amber-200/90">{c.code}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{int(c.customers)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{int(c.firstPayments)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{eur(c.commissionOwedEur)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{eur(c.commissionPaidEur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </main>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-amber-300/30 bg-amber-300/5" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="text-xs uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-white/45">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
      {children}
    </div>
  );
}
