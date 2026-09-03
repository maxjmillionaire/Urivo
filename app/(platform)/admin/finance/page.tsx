import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getFinanceSnapshot, modeledTiers, costPerActionReport } from "@/lib/finance/reporting";
import { EUR_PER_USD, USD_PER_EUR } from "@/lib/finance/cost-model";
import { PLANS } from "@/lib/plans";

import { getPlatformSettings, getFoundingStatus } from "@/lib/platform/settings";
import {
  getFirstSaleFunnel,
  getFirstSaleCohorts,
  firstSaleVerdict,
  FIRST_SALE_HEALTHY,
  FIRST_SALE_CRITICAL,
} from "@/lib/analytics/first-sale";
import { planName } from "@/lib/plans";
import { monthStart } from "@/lib/finance/reporting";
import { getTodaySnapshot, getBudgetStatus, getMarginByPlan } from "@/lib/finance/today";
import { getRevenue } from "@/lib/finance/revenue";
import { getImageCost } from "@/lib/finance/image-cost";
import { FreeGenerationsSwitch } from "./kill-switch";
import { CostControls } from "./cost-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Finance · Urivo (internal)", robots: { index: false, follow: false } };

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n || 0);
const eur4 = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n || 0);
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
  const founding = await getFoundingStatus();
  const actionCosts = await costPerActionReport();
  const firstSale = await getFirstSaleFunnel();
  const firstSaleCohorts = await getFirstSaleCohorts(12);
  const verdict = firstSaleVerdict(firstSale);

  // Measured economics: today, the budget, real revenue, real margin per plan.
  const [today, revenue, planMargins, imageCost] = await Promise.all([
    getTodaySnapshot(),
    getRevenue(monthStart()),
    getMarginByPlan(),
    getImageCost(),
  ]);
  const budget = await getBudgetStatus(snap.totalCostEur);
  const measuredMarginPct =
    revenue.totalEur > 0 ? ((revenue.totalEur - snap.totalCostEur) / revenue.totalEur) * 100 : null;
  // The mispricing signal: if credit pricing matched cost, €/credit would be
  // flat across every action. Name the spread so the gap is legible.
  const priced = actionCosts.filter((r) => r.costPerCreditEur > 0);
  const cpcMin = priced.length ? Math.min(...priced.map((r) => r.costPerCreditEur)) : 0;
  const cpcMax = priced.length ? Math.max(...priced.map((r) => r.costPerCreditEur)) : 0;
  const cpcSpread = cpcMin > 0 ? cpcMax / cpcMin : 0;
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
            <Link href="/admin/feedback" className="text-amber-300/90 hover:text-amber-200">
              → Feedback inbox
            </Link>
            <br />
            <Link href="/admin/testers" className="text-amber-300/90 hover:text-amber-200">
              → Testers
            </Link>
            <br />
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

        {/*
          * Provenance first. Every euro below that involves a generated photo
          * rests on this one rate, and an unlabelled estimate on a finance
          * dashboard is how a guess becomes a decision.
          */}
        {imageCost.isEstimate && (
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm">
            <p className="font-semibold text-amber-200">
              Image cost is still an estimate (${imageCost.rateUsd.toFixed(3)} per image).
            </p>
            <p className="mt-1 text-white/60">
              Five photos go into every generated store, so this is roughly two thirds of what a
              free signup costs — the largest single assumption in these numbers. Enter the real
              rate under Cost controls below and the whole history is recalculated at it.
            </p>
          </div>
        )}

        {/* Today — the only view in which a runaway day is visible while it is
            still today. A monthly average hides a tenfold day until it is over. */}
        <Section
          title="Today"
          subtitle={`${today.day} · measured from the usage ledger and recorded Stripe events`}
        >
          {/*
            * When the read failed, every tile shows a dash rather than €0.00.
            * A zero that means "unknown" is the most dangerous number a finance
            * dashboard can print: it is indistinguishable from a quiet day, and
            * it is the one a founder would act on.
            */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile
              label="AI spend today"
              value={today.available ? eur(today.costEur) : "—"}
              sub={
                today.available
                  ? `${int(today.actions)} actions · ${int(today.users)} accounts`
                  : "not readable"
              }
              accent={today.available}
            />
            <Tile
              label="Free vs paid"
              value={today.available ? eur(today.freeCostEur) : "—"}
              sub={today.available ? `free · ${eur(today.paidCostEur)} paid` : undefined}
            />
            <Tile
              label="Revenue today"
              value={today.available ? eur(today.revenueEur) : "—"}
              sub={
                !today.available
                  ? undefined
                  : today.revenueEur > 0
                    ? "recorded from Stripe"
                    : "nothing recorded yet"
              }
            />
            <Tile
              label="Margin today"
              value={today.available && today.marginPct !== null ? pct(today.marginPct) : "—"}
              sub={
                !today.available
                  ? undefined
                  : today.marginPct === null
                    ? "no revenue to divide by"
                    : "gross"
              }
            />
          </div>
          {today.topFeature && (
            <p className="text-sm text-white/50">
              Costliest surface today: <strong className="text-white/80">
                {FEATURE_LABEL[today.topFeature] ?? today.topFeature}
              </strong>{" "}
              at {eur(today.topFeatureEur)} across {int(today.topFeatureActions)} actions.
            </p>
          )}
          {!today.available && (
            <p className="text-sm text-amber-200/80">
              Today&rsquo;s figures could not be read. If migration 0037 has not been applied yet,
              that is why.
            </p>
          )}
        </Section>

        {/* Budget — "remaining" as a number rather than a feeling. */}
        <Section
          title="Budget"
          subtitle={
            budget.hasBudget
              ? `Day ${budget.daysElapsed} of ${budget.daysInMonth}`
              : "No monthly budget set — set one under Cost controls to make the projection actionable."
          }
        >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Spent this month" value={eur(budget.spentEur)} />
            <Tile
              label="Budget"
              value={budget.hasBudget ? eur(budget.budgetEur) : "—"}
              sub={budget.hasBudget ? pct(budget.usedPct) + " used" : undefined}
            />
            <Tile
              label="Remaining"
              value={budget.hasBudget ? eur(budget.remainingEur) : "—"}
            />
            <Tile
              label="Projected month end"
              value={eur(budget.projectedEur)}
              sub="straight-line from the run rate"
              accent={budget.projectedOver}
            />
          </div>
          {budget.projectedOver && (
            <p className="text-sm text-amber-200">
              At today&rsquo;s run rate the month lands at {eur(budget.projectedEur)} —{" "}
              {eur(budget.projectedEur - budget.budgetEur)} over budget.
            </p>
          )}
        </Section>

        {/* Founding members — the first 50 (private tracker, no public counter) */}
        <Section
          title="Founding members"
          subtitle={`The Founding 50 has ended — Urivo launches at standard pricing (Founder €${PLANS.core.price.regular} / Pro €${PLANS.pro.price.regular}). These are the legacy founding signups. Private — no public counter.`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Claimed" value={`${founding.claimed} / ${founding.cap}`} accent />
            <Tile label="Spots left" value={int(founding.remaining)} />
            <Tile label="Subscribed" value={int(founding.subscribed)} sub="paying founders" />
            <Tile label="Not yet paid" value={int(founding.claimed - founding.subscribed)} sub="signed up, no plan" />
          </div>
          {founding.members.length > 0 && (
            <div className="mt-4">
              <Table
                head={["Member", "Signed up", "Plan", "Status"]}
                rows={founding.members.map((m) => [
                  m.email,
                  new Date(m.createdAt).toLocaleDateString("de-DE", { day: "numeric", month: "short" }),
                  m.status === "active" ? planName(m.plan) : "—",
                  m.status,
                ])}
              />
            </div>
          )}
        </Section>

        {/* Cost controls */}
        <Section title="Cost controls" subtitle="The levers for runaway spend — every one changeable without a deploy">
          <FreeGenerationsSwitch initial={settings.freeGenerationsEnabled} />
          <CostControls
            thresholds={settings.dailySpendThresholdsEur}
            budgetEur={settings.monthlyAiBudgetEur}
            imageCostUsd={imageCost.rateUsd}
            imageCostSource={imageCost.source}
          />
          <p className="text-xs text-white/40">
            Alerts at €{settings.dailySpendThresholdsEur.join(", €")} of AI spend in a day, each
            once
            {settings.freeDailyGenerationCap > 0
              ? ` · daily free-generation cap: ${settings.freeDailyGenerationCap}`
              : " · no daily generation cap set"}
            .
          </p>
        </Section>

        {/*
          * Both halves measured. The tier table further down models margin from
          * list prices and a cost profile; this one divides recorded revenue by
          * recorded cost, and the two disagreeing is information rather than a
          * bug — it is where the model is wrong about the business.
          */}
        <Section
          title="Gross margin by plan (measured)"
          subtitle="Cost from the usage ledger, revenue from recorded Stripe events. Neither side modelled."
        >
          {planMargins.length === 0 ? (
            <p className="text-sm text-white/45">
              Nothing recorded yet this month. Revenue appears here as soon as the first Stripe
              payment arrives; cost appears as soon as anyone runs an AI action.
            </p>
          ) : (
            <Table
              head={["Plan", "Accounts", "Actions", "Credits", "Cost", "Revenue", "Profit", "Margin"]}
              rows={planMargins.map((p) => [
                p.name,
                int(p.users),
                int(p.actions),
                int(p.credits),
                eur(p.costEur),
                eur(p.revenueEur),
                eur(p.profitEur),
                p.marginPct === null ? "—" : pct(p.marginPct),
              ])}
            />
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Revenue this month" value={eur(revenue.totalEur)} sub={`${int(revenue.events)} payments`} />
            <Tile label="Subscriptions" value={eur(revenue.subscriptionEur)} />
            <Tile
              label="Credit packs"
              value={eur(revenue.packEur)}
              sub={revenue.refundEur < 0 ? `${eur(revenue.refundEur)} refunded` : undefined}
            />
            <Tile
              label="Margin overall"
              value={measuredMarginPct === null ? "—" : pct(measuredMarginPct)}
              sub={measuredMarginPct === null ? "no revenue recorded yet" : "measured, not modelled"}
              accent
            />
          </div>
          {revenue.nonEurEvents > 0 && (
            <p className="text-sm text-amber-200/80">
              {int(revenue.nonEurEvents)} payment(s) in another currency are excluded from these
              totals rather than converted at an invented rate.
            </p>
          )}
        </Section>

        {/* The number the company steers by — first, and on its own. */}
        <Section
          title="First sale"
          subtitle="Share of published stores that make a real sale, and how long it takes. Every other metric is downstream of this one."
        >
          <div
            className={`rounded-xl border p-5 ${
              verdict === "healthy"
                ? "border-emerald-300/30 bg-emerald-300/5"
                : verdict === "critical"
                  ? "border-rose-400/30 bg-rose-400/5"
                  : verdict === "watch"
                    ? "border-amber-300/30 bg-amber-300/5"
                    : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-white/45">First-sale rate</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {firstSale.storesPublished === 0 ? "—" : `${firstSale.firstSaleRate.toFixed(1)}%`}
            </p>
            <p className="mt-2 text-sm text-white/60">
              {verdict === "no_data"
                ? "No stores published yet. This fills in once merchants go live."
                : verdict === "healthy"
                  ? `Healthy — at or above ${FIRST_SALE_HEALTHY}%. The product is working. Scale acquisition.`
                  : verdict === "critical"
                    ? `Critical — below ${FIRST_SALE_CRITICAL}%. Merchants are not selling. Fix this before spending anything on growth.`
                    : `Watch — between ${FIRST_SALE_CRITICAL}% and ${FIRST_SALE_HEALTHY}%. Not yet proven. Improve the path to a first sale before scaling.`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="Stores published" value={int(firstSale.storesPublished)} />
            <Tile label="Have sold" value={int(firstSale.storesWithSale)} sub="paid or fulfilled" />
            <Tile
              label="Sold in 30 days"
              value={firstSale.storesPublished === 0 ? "—" : `${firstSale.rateWithin30d.toFixed(1)}%`}
              sub="leading indicator"
              accent
            />
            <Tile
              label="Median days"
              value={firstSale.medianDaysToFirstSale == null ? "—" : firstSale.medianDaysToFirstSale.toFixed(1)}
              sub="publish → first sale"
            />
            <Tile
              label="7d / 30d / 90d"
              value={`${int(firstSale.soldWithin7d)} / ${int(firstSale.soldWithin30d)} / ${int(firstSale.soldWithin90d)}`}
              sub="stores selling within"
            />
          </div>

          {firstSaleCohorts.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-white/40">
                By publish week — a blended rate hides whether the product is improving.
              </p>
              <Table
                head={["Cohort week", "Published", "Sold", "Rate", "Median days"]}
                rows={firstSaleCohorts.map((c) => [
                  new Date(c.cohortWeek).toLocaleDateString("de-DE", { day: "numeric", month: "short" }),
                  c.storesPublished,
                  c.storesWithSale,
                  `${c.firstSaleRate.toFixed(1)}%`,
                  c.medianDaysToFirstSale == null ? "—" : c.medianDaysToFirstSale.toFixed(1),
                ])}
              />
            </div>
          )}
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
            MRR is a <strong>proxy</strong>: active subscriptions counted at list price, so it reads
            {" "}{eur(0)} until someone is on a paid plan, and it does not know that a founding{" "}
            {planName("core")} pays {eur(PLANS.core.price.founding ?? PLANS.core.price.regular)}{" "}
            rather than {eur(PLANS.core.price.regular)}. Money that actually arrived is under{" "}
            <strong>Revenue this month</strong> below, recorded from Stripe events. Cost, tokens,
            images and credits are real, straight from the ledger.
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

        {/* Cost per action (measured) — the basis for repricing, not a repricing */}
        <Section
          title="Cost per action (measured, by model)"
          subtitle="Real unit cost from the ledger vs the credits charged — the basis for a pricing decision, not a pricing change"
        >
          {actionCosts.length === 0 ? (
            <Empty>No AI actions recorded yet — this populates as real usage arrives.</Empty>
          ) : (
            <>
              <Table
                head={["Feature", "Model", "Actions", "Avg in tok", "Avg out tok", "Avg cost", "Credits", "€ / credit"]}
                rows={actionCosts.map((r) => [
                  FEATURE_LABEL[r.feature] ?? r.feature,
                  r.model,
                  int(r.actions),
                  int(r.avgInputTokens),
                  int(r.avgOutputTokens),
                  eur4(r.avgCostEur),
                  r.creditsPerAction.toFixed(r.creditsPerAction < 10 ? 1 : 0),
                  r.costPerCreditEur > 0 ? eur4(r.costPerCreditEur) : "—",
                ])}
              />
              <p className="mt-2 text-xs text-white/50">
                {priced.length >= 2 && cpcSpread >= 1.5 ? (
                  <>
                    If credit pricing matched cost, “€ / credit” would be roughly flat. It ranges{" "}
                    {eur4(cpcMin)}–{eur4(cpcMax)} — a <strong>{cpcSpread.toFixed(1)}× spread</strong>, so some
                    actions are underpriced relative to others. Reprice on this once there are a few hundred real
                    generations. The credit table is deliberately unchanged.
                  </>
                ) : (
                  <>
                    The “€ / credit” column exposes any mispricing once there is enough volume. The credit table is
                    deliberately unchanged.
                  </>
                )}
              </p>
            </>
          )}
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
