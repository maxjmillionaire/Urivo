import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getFinanceSnapshot, modeledTiers } from "@/lib/finance/reporting";
import { EUR_PER_USD, USD_PER_EUR } from "@/lib/finance/cost-model";
import { getPlatformSettings } from "@/lib/platform/settings";
import { FreeGenerationsSwitch } from "./kill-switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Finance · Urivo (internal)", robots: { index: false, follow: false } };

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n || 0);
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;
const int = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n || 0));
const FEATURE_LABEL: Record<string, string> = {
  storeGeneration: "Store generation",
  askMessage: "Ask Urivo",
  storeEdit: "Store editor",
  marketResearch: "Market research",
  adStudio: "Ad Studio",
  productImage: "Product image",
};

export default async function FinanceDashboardPage() {
  // Gate: authenticated AND on the admin allow-list. 404 (not 403) so the route
  // isn't discoverable by non-admins.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  const snap = await getFinanceSnapshot();
  const tiers = modeledTiers();
  const settings = await getPlatformSettings();
  const periodLabel = new Date(snap.periodStart).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="min-h-screen bg-[#0b1220] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Internal · CFO</p>
            <h1 className="mt-1 text-3xl font-semibold">Finance</h1>
            <p className="mt-1 text-sm text-white/50">
              Real cost from the usage ledger · {periodLabel} (month to date)
            </p>
          </div>
          <div className="text-right text-xs text-white/40">
            <Link href="/admin/referrals" className="text-amber-300/90 hover:text-amber-200">
              → Creator referrals
            </Link>
            <p className="mt-2">
              All figures net of VAT · FX 1&nbsp;USD = {EUR_PER_USD.toFixed(3)}&nbsp;€
              <br />
              (1&nbsp;€ = {USD_PER_EUR.toFixed(2)}&nbsp;$)
            </p>
          </div>
        </header>

        {/* Cost controls */}
        <Section title="Cost controls" subtitle="The levers for runaway free-tier spend — changeable without a deploy">
          <FreeGenerationsSwitch initial={settings.freeGenerationsEnabled} />
          <p className="text-xs text-white/40">
            Spend alert fires once/day when free-account AI cost crosses ${settings.dailyFreeSpendAlertUsd.toFixed(2)}
            {settings.freeDailyGenerationCap > 0
              ? ` · daily free-generation cap: ${settings.freeDailyGenerationCap}`
              : " · no daily generation cap set"}
            .
          </p>
        </Section>

        {/* Headline KPIs */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="MRR (proxy)" value={eur(snap.mrrEur)} sub={`ARR ${eur(snap.arrEur)}`} accent />
          <Tile label="AI cost (real)" value={eur(snap.totalCostEur)} sub={`${int(snap.actionCount)} actions`} />
          <Tile label="Gross margin" value={snap.mrrEur > 0 ? pct(snap.grossMarginPct) : "—"} sub="MRR − AI cost" />
          <Tile label="Active AI users" value={int(snap.activeUsers)} sub={`${int(snap.totalUsers)} total`} />
          <Tile label="ARPU" value={eur(snap.arpuEur)} sub="per all users" />
          <Tile label="ARPPU" value={eur(snap.arppuEur)} sub="per paying user" />
          <Tile label="Cost / active user" value={eur(snap.avgCostPerActiveUserEur)} sub="AI + images" />
          <Tile
            label="Credits burned"
            value={int(snap.creditsBurned)}
            sub={`${int(snap.creditsGranted)} granted`}
          />
        </section>

        {snap.mrrEur === 0 && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200/90">
            Revenue is a proxy from active subscriptions and reads €0 until Stripe is wired (Phase 2).
            Cost, tokens, images and credits below are <strong>real</strong>, straight from the ledger.
          </p>
        )}

        {/* Cost by feature */}
        <Section title="Cost by feature (real)" subtitle="Where the money actually goes this month">
          {snap.byFeature.length === 0 ? (
            <Empty>No AI actions recorded yet this month.</Empty>
          ) : (
            <Table
              head={["Feature", "Actions", "Credits", "In tok", "Out tok", "Images", "Cost"]}
              rows={snap.byFeature.map((f) => [
                FEATURE_LABEL[f.feature] ?? f.feature,
                int(f.actions),
                int(f.credits),
                int(f.inputTokens),
                int(f.outputTokens),
                int(f.images),
                eur(f.costEur),
              ])}
            />
          )}
          <div className="mt-2 flex gap-6 text-xs text-white/50">
            <span>Anthropic {eur(snap.anthropicCostEur)}</span>
            <span>Images {eur(snap.imageCostEur)}</span>
            <span>
              Tokens {int(snap.inputTokens)} in / {int(snap.outputTokens)} out
            </span>
          </div>
        </Section>

        {/* Top users by cost */}
        <Section title="Costliest users (real)" subtitle="Exactly what each user cost us this month">
          {snap.topUsers.length === 0 ? (
            <Empty>No user cost recorded yet this month.</Empty>
          ) : (
            <Table
              head={["User", "Actions", "Credits", "Cost"]}
              rows={snap.topUsers.map((u) => [u.email, int(u.actions), int(u.credits), eur(u.costEur)])}
            />
          )}
        </Section>

        {/* Live tier rollup */}
        <Section title="Tiers — live subscribers" subtitle="Active subscriptions (proxy) and modeled margin">
          <Table
            head={["Tier", "Price/mo", "Active subs", "MRR", "Margin (real.)", "Margin (worst)"]}
            rows={snap.tiers.map((t) => [
              t.name,
              eur(t.monthlyPriceEur),
              int(t.activeSubscribers),
              eur(t.mrrEur),
              pct(t.modeledMarginRealisticPct),
              pct(t.modeledMarginWorstPct),
            ])}
          />
        </Section>

        {/* Modeled economics (simulator, no live data needed) */}
        <Section
          title="Modeled unit economics (simulator)"
          subtitle="Per-subscriber margin from the cost model — updates the moment pricing/credits change"
        >
          <Table
            head={["Tier", "Price", "Credits", "AI (real.)", "AI (worst)", "Margin (real.)", "Margin (worst)"]}
            rows={tiers.map((t) => [
              t.name,
              eur(t.price),
              int(t.credits),
              eur(t.econ.aiCostRealisticEur),
              eur(t.econ.aiCostWorstEur),
              t.price > 0 ? pct(t.econ.marginRealisticPct) : "—",
              t.price > 0 ? pct(t.econ.marginWorstPct) : "—",
            ])}
          />
          <p className="mt-2 text-xs text-white/40">
            Blended realistic cost ≈ €{tiers[1]?.econ.blendedCostPerCreditEur.toFixed(4)}/credit · guaranteed
            worst ≈ €{tiers[1]?.econ.worstCostPerCreditEur.toFixed(4)}/credit.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? "border-amber-300/30 bg-amber-300/5" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase tracking-wide text-white/45">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2.5 font-medium ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-white/[0.06] last:border-0">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-2.5 tabular-nums ${ci === 0 ? "text-white/90" : "text-right text-white/70"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
      {children}
    </div>
  );
}
