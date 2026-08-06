import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCreditBalance, getCreditExpiry, STORE_GENERATION_COST, type CreditExpiry } from "@/lib/credits";
import { planName, canPublish as planCanPublish, volumeMessage } from "@/lib/plans";
import { storeStatsFor, sumStats, type StoreStats } from "@/lib/analytics/visits";

/*
 * The Executive Command Center data layer.
 *
 * One call assembles everything the Home dashboard shows — a live daily
 * briefing, executive KPIs with real deltas, a Business Health score, the AI
 * activity feed, ranked next-best actions, a real event timeline and a mini
 * dashboard per store — all from real tables (orders, storefront visits,
 * products, supplier sources, the AI usage ledger, the credit ledger and the
 * decision-intelligence aggregate).
 *
 * Discipline: nothing here is invented. When a metric has no data yet it is
 * marked `awaiting` so the UI can show an honest "measuring…" state instead of
 * a fake number, and impact estimates for opportunities are directional labels,
 * never fabricated euro figures.
 */

// ── Public shapes ──────────────────────────────────────────────────────────

export type KpiDisplay = "currency" | "number" | "percent";

export interface Kpi {
  key: string;
  label: string;
  value: number; // in display units (euros for currency, count, or percent)
  display: KpiDisplay;
  deltaPct: number | null; // vs the comparison period; null when incomparable
  isNew: boolean; // prev period was 0 but now there's activity
  sub: string;
  awaiting: boolean; // no data yet → elegant "measuring" state
  gold?: boolean;
}

export interface HealthSignal {
  ok: boolean;
  label: string;
  soon?: boolean; // informational, not counted against the score (e.g. Phase 2)
}

export interface BusinessHealth {
  score: number;
  band: "Excellent" | "Strong" | "Fair" | "Needs attention" | "Getting started";
  signals: HealthSignal[];
}

export interface AiActivity {
  label: string;
  detail?: string;
  live?: boolean; // the always-on line (Merchant Intelligence), rendered pulsing
}

export type OppTone = "growth" | "setup" | "risk" | "soon";

export interface Opportunity {
  id: string;
  tone: OppTone;
  title: string;
  detail: string;
  impact: string; // directional, honest — never a fabricated euro figure
  cta: string;
  href: string;
  soon?: boolean;
}

export interface TimelineEvent {
  at: string; // ISO
  label: string;
  detail?: string;
  kind: "order" | "import" | "ai" | "store";
}

export interface StoreCard {
  id: string;
  name: string;
  subdomain: string;
  isLive: boolean;
  revenueTodayCents: number;
  ordersToday: number;
  visitorsToday: number;
  conversionPct: number | null;
  products: number;
  health: number;
  latestAction: string | null;
  /** Emails captured from the storefront — the merchant's pre-first-sale asset. */
  subscribers: number;
}

export interface Moment {
  emoji: string;
  text: string;
}

export interface Briefing {
  greeting: string;
  lines: string[];
}

export interface DashboardOverview {
  briefing: Briefing;
  moment: Moment | null;
  kpis: Kpi[];
  health: BusinessHealth;
  aiStatus: AiActivity[];
  opportunities: Opportunity[];
  timeline: TimelineEvent[];
  storeCards: StoreCard[];
  planLabel: string;
  hasPlan: boolean;
  canGenerate: boolean;
  canPublish: boolean;
  credits: number;
  creditsExpiry: CreditExpiry | null;
  storeCount: number;
  /** Live stores that cannot take a payment — money is being turned away now. */
  liveWithoutPayments: number;
  /** Paid orders this calendar month, against the tier's allowance. */
  ordersThisMonth: number;
  volumeNotice: { title: string; detail: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const eur = (cents: number) => Math.round(cents) / 100;
const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);

function deltaPct(cur: number, prev: number): { deltaPct: number | null; isNew: boolean } {
  if (prev > 0) return { deltaPct: ((cur - prev) / prev) * 100, isNew: false };
  return { deltaPct: null, isNew: cur > 0 };
}

function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function euros(cents: number): string {
  const v = eur(cents);
  return v % 1 === 0 ? `€${v.toLocaleString("en-US")}` : `€${v.toFixed(2)}`;
}

/** Live-stores subline that names the remainder instead of a bare total. */
function storesSub(live: number, total: number, canPublish: boolean): string {
  if (total === 0) return "none yet";
  const rest = total - live;
  if (rest <= 0) return live === 1 ? "1 store, live" : "all live";
  // "paused" is an adjective (2 paused); "draft" is a noun (2 drafts).
  return canPublish ? `${rest} paused` : `${rest} draft${rest === 1 ? "" : "s"}`;
}

/** Credits subline in OUTCOMES, not units — what the balance actually buys. */
function creditsSub(credits: number): string {
  const stores = Math.floor(credits / STORE_GENERATION_COST);
  if (stores >= 1) return `≈ ${stores} more store${stores === 1 ? "" : "s"}`;
  if (credits > 0) return "≈ a round of edits";
  return "topped up on renewal";
}

const FEATURE_LABEL: Record<string, string> = {
  store_generation: "Generated a store",
  store_edit: "Applied a store edit",
  market_research: "Researched the market",
  ad_studio: "Built ad creative",
  product_image: "Rendered product imagery",
  seo: "Optimized store SEO",
  ask: "Answered your question",
};

// ── The builder ────────────────────────────────────────────────────────────

export async function buildDashboardOverview(
  userId: string,
  fullName: string | null,
): Promise<DashboardOverview> {
  const admin = supabaseAdmin();
  const now = new Date();

  const [{ data: profile }, credits, creditsExpiry, { data: storeRows }] = await Promise.all([
    admin.from("profiles").select("plan, stripe_charges_enabled").eq("id", userId).single(),
    getCreditBalance(userId).catch(() => 0),
    getCreditExpiry(userId).catch(() => null),
    admin
      .from("stores")
      .select("id, store_name, subdomain, is_active, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const stores = storeRows ?? [];
  const storeIds = stores.map((s) => s.id);
  const plan = profile?.plan ?? "free";
  const planLabel = planName(plan);
  const hasPlan = plan === "core" || plan === "pro";
  const canPublish = planCanPublish(plan);

  // Pull the heavy facts in parallel: per-store stats (RPC), catalogue, supplier
  // sources, recent AI usage, recent orders, and the intelligence sample size.
  const since14d = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [
    stats,
    { data: productRows },
    { data: sourceRows },
    { data: aiRows },
    { data: orderRows },
    { count: intelSample },
  ] = await Promise.all([
    storeStatsFor(storeIds),
    storeIds.length
      ? admin.from("products").select("id, store_id, price_eur").in("store_id", storeIds)
      : Promise.resolve({ data: [] as { id: string; store_id: string; price_eur: number }[] }),
    storeIds.length
      ? admin
          .from("product_sources")
          .select("product_id, store_id, supplier_cost_eur, sync_status, created_at")
          .in("store_id", storeIds)
      : Promise.resolve({ data: [] as SourceRow[] }),
    admin
      .from("ai_usage_ledger")
      .select("feature, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    storeIds.length
      ? admin
          .from("orders")
          .select("store_id, amount_total, customer_name, created_at, status")
          .in("store_id", storeIds)
          .in("status", ["paid", "fulfilled"])
          .gte("created_at", since14d)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as OrderRow[] }),
    admin.from("decision_performance").select("id", { count: "exact", head: true }),
  ]);

  const products = (productRows ?? []) as ProductRow[];
  const sources = (sourceRows ?? []) as SourceRow[];
  const priceByProduct = new Map(products.map((p) => [p.id, Number(p.price_eur)]));

  // Portfolio totals.
  const total = sumStats(stats.values());
  const liveStores = stores.filter((s) => s.is_active).length;
  const productCount = products.length;
  /*
   * Payment readiness lives on the PROFILE, not the store (migration 0026 moved
   * payout accounts to the merchant). This read used to come from the store's
   * deprecated column, which nothing has written since — so a merchant who had
   * successfully connected Stripe was still told they had not, forever, and lost
   * 22 points of health score for it.
   */
  const paymentsConnected = profile?.stripe_charges_enabled === true;

  // Per-store product counts.
  const productsByStore = new Map<string, number>();
  for (const p of products) productsByStore.set(p.store_id, (productsByStore.get(p.store_id) ?? 0) + 1);

  // Margins + sync health from supplier sources.
  let marginSum = 0;
  let marginCount = 0;
  let badSync = 0;
  for (const s of sources) {
    if (s.sync_status !== "synced") badSync++;
    const price = priceByProduct.get(s.product_id);
    const cost = s.supplier_cost_eur != null ? Number(s.supplier_cost_eur) : null;
    if (price && price > 0 && cost != null) {
      marginSum += (price - cost) / price;
      marginCount++;
    }
  }
  const avgMargin = marginCount > 0 ? marginSum / marginCount : null;
  const lowMargin = (() => {
    let n = 0;
    for (const s of sources) {
      const price = priceByProduct.get(s.product_id);
      const cost = s.supplier_cost_eur != null ? Number(s.supplier_cost_eur) : null;
      if (price && price > 0 && cost != null && (price - cost) / price < 0.4) n++;
    }
    return n;
  })();

  // ── KPIs ────────────────────────────────────────────────────────────────
  const convToday = pct(total.ordersToday, total.visitorsToday);
  const convYest = pct(total.ordersYesterday, total.visitorsYesterday);
  const aovCents = total.orders7d > 0 ? total.revenue7dCents / total.orders7d : total.ordersTotal > 0 ? total.revenueTotalCents / total.ordersTotal : 0;

  const kpis: Kpi[] = [
    {
      key: "revenue",
      label: "Revenue today",
      value: eur(total.revenueTodayCents),
      display: "currency",
      ...deltaPct(total.revenueTodayCents, total.revenueYesterdayCents),
      sub: "vs yesterday",
      awaiting: total.revenueTotalCents === 0,
      gold: true,
    },
    {
      key: "orders",
      label: "Orders today",
      value: total.ordersToday,
      display: "number",
      ...deltaPct(total.ordersToday, total.ordersYesterday),
      sub: "vs yesterday",
      awaiting: total.ordersTotal === 0,
    },
    {
      key: "visitors",
      label: "Visitors today",
      value: total.visitorsToday,
      display: "number",
      ...deltaPct(total.visitorsToday, total.visitorsYesterday),
      sub: "vs yesterday",
      awaiting: total.visitors7d === 0 && total.viewsToday === 0,
    },
    {
      key: "conversion",
      label: "Conversion",
      value: convToday ?? 0,
      display: "percent",
      ...(convToday != null && convYest != null
        ? deltaPct(convToday, convYest)
        : { deltaPct: null, isNew: false }),
      sub: "orders / visitors",
      awaiting: total.visitorsToday === 0,
    },
    {
      key: "aov",
      label: "Avg order value",
      value: eur(aovCents),
      display: "currency",
      deltaPct: null,
      isNew: false,
      sub: total.orders7d > 0 ? "7-day average" : "lifetime average",
      awaiting: total.ordersTotal === 0,
    },
    {
      key: "stores",
      label: "Live stores",
      value: liveStores,
      display: "number",
      deltaPct: null,
      isNew: false,
      // Unambiguous: name what the rest are, not just a total (a total next to a
      // plan card reads like a quota). "1 paused" / "2 drafts" says it plainly.
      sub: storesSub(liveStores, stores.length, canPublish),
      awaiting: false,
    },
    {
      key: "credits",
      label: "AI credits",
      value: credits,
      display: "number",
      deltaPct: null,
      isNew: false,
      // Legible in outcomes, not units: what this balance actually buys. The
      // full per-action breakdown is one tap away in the card's popover.
      sub: creditsSub(credits),
      awaiting: false,
      gold: true,
    },
  ];

  // ── Business Health ───────────────────────────────────────────────────────
  const health = buildHealth({
    liveStores,
    productCount,
    paymentsConnected,
    avgMargin,
    marginCount,
    badSync,
    hasSources: sources.length > 0,
    conv7d: pct(total.orders7d, total.visitors7d),
    hasTraffic: total.visitors7d > 0,
    storeCount: stores.length,
  });

  // ── AI activity ──────────────────────────────────────────────────────────
  const aiStatus = buildAiStatus(
    (aiRows ?? []) as { feature: string; created_at: string }[],
    sources,
    Number(intelSample ?? 0),
  );

  // ── Opportunities ─────────────────────────────────────────────────────────
  const opportunities = buildOpportunities({
    stores,
    productsByStore,
    canPublish,
    paymentsConnected,
    lowMargin,
    badSync,
    credits,
    stats,
  });

  // ── Timeline ──────────────────────────────────────────────────────────────
  const timeline = buildTimeline({
    orders: (orderRows ?? []) as OrderRow[],
    sources,
    ai: (aiRows ?? []) as { feature: string; created_at: string }[],
    stores,
    storeNames: new Map(stores.map((s) => [s.id, s.store_name])),
  });

  // ── Store cards ───────────────────────────────────────────────────────────
  const latestByStore = latestActionByStore(
    (orderRows ?? []) as OrderRow[],
    sources,
    new Map(stores.map((s) => [s.id, s.store_name])),
  );
  /*
   * Storefront email captures. Best-effort: on an environment that has not run
   * migration 0029 yet, a missing count costs a number on a card, never the
   * dashboard.
   */
  const subscribersByStore = new Map<string, number>();
  try {
    const { data: subRows } = await admin.rpc("store_subscriber_counts", { p_user_id: userId });
    for (const r of (subRows ?? []) as { store_id: string; subscribers: number }[]) {
      subscribersByStore.set(r.store_id, Number(r.subscribers) || 0);
    }
  } catch {
    /* pre-0029 environment — cards simply show no list yet */
  }

  /*
   * Order volume against the plan's tier boundary. Best-effort: on an
   * environment without migration 0033 the merchant simply sees no prompt.
   */
  let ordersThisMonth = 0;
  try {
    const { data } = await admin.rpc("monthly_paid_orders", { p_user_id: userId });
    ordersThisMonth = Number(data) || 0;
  } catch {
    /* pre-0033 — no prompt rather than a wrong one */
  }

  const storeCards: StoreCard[] = stores.map((s) => {
    const st = stats.get(s.id) ?? sumStats([]);
    const prod = productsByStore.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.store_name,
      subdomain: s.subdomain,
      isLive: s.is_active,
      revenueTodayCents: st.revenueTodayCents,
      ordersToday: st.ordersToday,
      visitorsToday: st.visitorsToday,
      conversionPct: pct(st.ordersToday, st.visitorsToday),
      products: prod,
      health: storeHealth(s.is_active, prod, paymentsConnected),
      latestAction: latestByStore.get(s.id) ?? null,
      subscribers: subscribersByStore.get(s.id) ?? 0,
    };
  });

  // ── Moment + briefing ─────────────────────────────────────────────────────
  const moment = buildMoment({ total, stats, sources, now });
  const briefing = buildBriefing({
    greeting: greeting(now.getUTCHours()),
    fullName,
    total,
    stores,
    stats,
    aiCount24h: countRecent((aiRows ?? []) as { created_at: string }[], now, 86_400_000),
    opportunities: opportunities.length,
  });

  return {
    briefing,
    moment,
    kpis,
    health,
    aiStatus,
    opportunities: opportunities.slice(0, 4),
    timeline: timeline.slice(0, 8),
    storeCards,
    planLabel,
    hasPlan,
    canGenerate: credits >= STORE_GENERATION_COST,
    canPublish,
    credits,
    creditsExpiry,
    storeCount: stores.length,
    liveWithoutPayments: paymentsConnected ? 0 : liveStores,
    ordersThisMonth,
    volumeNotice: volumeMessage(plan, ordersThisMonth),
  };
}

// ── Row types ──────────────────────────────────────────────────────────────
interface ProductRow {
  id: string;
  store_id: string;
  price_eur: number;
}
interface SourceRow {
  product_id: string;
  store_id: string;
  supplier_cost_eur: number | null;
  sync_status: string;
  created_at: string;
}
interface OrderRow {
  store_id: string;
  amount_total: number;
  customer_name: string | null;
  created_at: string;
  status: string;
}
interface StoreRow {
  id: string;
  store_name: string;
  subdomain: string;
  is_active: boolean;
  created_at: string;
}

// ── Health ─────────────────────────────────────────────────────────────────
function buildHealth(x: {
  liveStores: number;
  productCount: number;
  paymentsConnected: boolean;
  avgMargin: number | null;
  marginCount: number;
  badSync: number;
  hasSources: boolean;
  conv7d: number | null;
  hasTraffic: boolean;
  storeCount: number;
}): BusinessHealth {
  if (x.storeCount === 0) {
    return {
      score: 0,
      band: "Getting started",
      signals: [
        { ok: false, label: "Generate your first store to begin" },
        { ok: false, label: "Add products and connect payments" },
      ],
    };
  }

  const signals: HealthSignal[] = [];
  let ok = 0;
  let weight = 0;
  const add = (w: number, cond: boolean, good: string, bad: string) => {
    weight += w;
    if (cond) ok += w;
    signals.push({ ok: cond, label: cond ? good : bad });
  };

  add(24, x.liveStores > 0, "At least one store is live", "No store published yet");
  add(18, x.productCount > 0, "Catalogue is stocked", "Add products to your store");
  add(22, x.paymentsConnected, "Payments connected", "Connect payments to accept orders");
  if (x.marginCount > 0 && x.avgMargin != null) {
    add(
      18,
      x.avgMargin >= 0.5,
      `Healthy margins (${Math.round(x.avgMargin * 100)}%)`,
      `Margins below target (${Math.round(x.avgMargin * 100)}%)`,
    );
  }
  if (x.hasSources) {
    add(10, x.badSync === 0, "Supplier inventory in sync", `${x.badSync} product${x.badSync === 1 ? "" : "s"} need a resync`);
  }
  if (x.hasTraffic && x.conv7d != null) {
    add(12, x.conv7d >= 1.5, `Converting at ${x.conv7d.toFixed(1)}%`, `Conversion is low (${x.conv7d.toFixed(1)}%)`);
  }

  // Phase 2 — informational, not scored (users can't act on it yet).
  signals.push({ ok: false, soon: true, label: "Revenue Automation — coming soon" });

  const score = weight > 0 ? Math.round((ok / weight) * 100) : 0;
  const band: BusinessHealth["band"] =
    score >= 85 ? "Excellent" : score >= 70 ? "Strong" : score >= 50 ? "Fair" : "Needs attention";
  return { score, band, signals };
}

function storeHealth(isLive: boolean, products: number, payments: boolean): number {
  let ok = 0;
  let w = 0;
  const add = (weight: number, cond: boolean) => {
    w += weight;
    if (cond) ok += weight;
  };
  add(40, isLive);
  add(35, products > 0);
  add(25, payments);
  return w > 0 ? Math.round((ok / w) * 100) : 0;
}

// ── AI activity ────────────────────────────────────────────────────────────
function buildAiStatus(
  ai: { feature: string; created_at: string }[],
  sources: SourceRow[],
  intelSample: number,
): AiActivity[] {
  const out: AiActivity[] = [];

  // Most recent import batch → "Imported N products" + "Optimized pricing".
  if (sources.length) {
    const latestImport = sources.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const batch = sources.filter((s) => Math.abs(new Date(s.created_at).getTime() - new Date(latestImport.created_at).getTime()) < 5 * 60_000);
    out.push({ label: `Imported ${batch.length} product${batch.length === 1 ? "" : "s"}`, detail: "with margin-aware pricing" });
    out.push({ label: "Optimized product copy", detail: "rewritten on-brand" });
  }

  for (const row of ai.slice(0, 3)) {
    const label = FEATURE_LABEL[row.feature];
    if (label && !out.some((o) => o.label === label)) out.push({ label });
    if (out.length >= 4) break;
  }

  if (out.length === 0) {
    out.push({ label: "Ready to source your next winning product" });
  }

  // The always-on truth: the decision engine keeps improving defaults.
  out.push({
    label: "Merchant Intelligence improving your defaults",
    detail: intelSample > 0 ? `learning from ${intelSample} experiments` : "learning as you grow",
    live: true,
  });

  return out.slice(0, 5);
}

// ── Opportunities ──────────────────────────────────────────────────────────
function buildOpportunities(x: {
  stores: StoreRow[];
  productsByStore: Map<string, number>;
  canPublish: boolean;
  paymentsConnected: boolean;
  lowMargin: number;
  badSync: number;
  credits: number;
  stats: Map<string, StoreStats>;
}): Opportunity[] {
  const ops: Opportunity[] = [];

  if (x.stores.length === 0) {
    ops.push({
      id: "first-store",
      tone: "setup",
      title: "Generate your first store",
      detail: "Describe an idea — Urivo builds the brand, catalogue and storefront.",
      impact: "Launch in a minute",
      cta: "Generate",
      href: "/dashboard",
    });
    return ops;
  }

  for (const s of x.stores) {
    const prod = x.productsByStore.get(s.id) ?? 0;
    if (prod === 0) {
      ops.push({
        id: `stock-${s.id}`,
        tone: "setup",
        title: `Stock ${s.store_name} with products`,
        detail: "Let Urivo source and import real products from your supplier.",
        impact: "Turn the storefront into a shop",
        cta: "Source products",
        href: `/dashboard/stores/${s.id}`,
      });
    }
  }

  // Drafts that could be live.
  const draft = x.stores.find((s) => !s.is_active && (x.productsByStore.get(s.id) ?? 0) > 0);
  if (draft) {
    ops.push(
      x.canPublish
        ? {
            id: `publish-${draft.id}`,
            tone: "growth",
            title: `Publish ${draft.store_name}`,
            detail: "Your store is ready — take it live and start selling.",
            impact: "Go live today",
            cta: "Publish",
            href: `/dashboard/stores/${draft.id}`,
          }
        : {
            id: "upgrade-publish",
            tone: "growth",
            title: `Take ${draft.store_name} live`,
            detail: "Upgrade to publish your store to its own address.",
            impact: "Start accepting orders",
            cta: "See plans",
            href: "/dashboard/billing",
          },
    );
  }

  // Traffic that isn't converting yet.
  const stalled = x.stores.find((s) => {
    const st = x.stats.get(s.id);
    return st && st.visitors7d >= 20 && st.orders7d === 0;
  });
  if (stalled) {
    ops.push({
      id: `convert-${stalled.id}`,
      tone: "growth",
      title: `Turn ${stalled.store_name}'s visitors into buyers`,
      detail: "Visitors are arriving but not checking out. Sharpen the storefront and offer.",
      impact: "Lift conversion",
      cta: "Improve store",
      href: `/dashboard/stores/${stalled.id}`,
    });
  }

  if (x.paymentsConnected === false && x.stores.some((s) => s.is_active)) {
    ops.push({
      id: "payments",
      tone: "risk",
      title: "Connect payments",
      detail: "A live store can't take money until payments are connected.",
      impact: "Accept real orders",
      cta: "Connect",
      href: "/dashboard/settings",
    });
  }

  if (x.lowMargin > 0) {
    ops.push({
      id: "margins",
      tone: "risk",
      title: `Review pricing on ${x.lowMargin} product${x.lowMargin === 1 ? "" : "s"}`,
      detail: "Some products are priced below a healthy margin.",
      impact: "Protect your profit",
      cta: "Review",
      href: `/dashboard/stores/${x.stores[0].id}`,
    });
  }

  if (x.badSync > 0) {
    ops.push({
      id: "resync",
      tone: "risk",
      title: `Resync ${x.badSync} product${x.badSync === 1 ? "" : "s"}`,
      detail: "Supplier stock or pricing has drifted out of sync.",
      impact: "Keep stock accurate",
      cta: "Resync",
      href: `/dashboard/stores/${x.stores[0].id}`,
    });
  }

  if (x.credits < STORE_GENERATION_COST) {
    ops.push({
      id: "credits",
      tone: "setup",
      title: "Top up your AI credits",
      detail: "You're low on credits for new generations.",
      impact: "Keep building",
      cta: "Get credits",
      href: "/dashboard/billing",
    });
  }

  // Always surface the Phase-2 growth lever as a soon-item if room remains.
  ops.push({
    id: "revenue-automation",
    tone: "soon",
    title: "Set up Revenue Automation",
    detail: "Abandoned-cart and win-back flows that recover lost sales — arriving soon.",
    impact: "Recover lost revenue",
    cta: "Coming soon",
    href: "/dashboard/emails",
    soon: true,
  });

  return ops;
}

// ── Timeline ───────────────────────────────────────────────────────────────
function buildTimeline(x: {
  orders: OrderRow[];
  sources: SourceRow[];
  ai: { feature: string; created_at: string }[];
  stores: StoreRow[];
  storeNames: Map<string, string>;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const o of x.orders.slice(0, 6)) {
    events.push({
      at: o.created_at,
      kind: "order",
      label: `New order · ${euros(o.amount_total)}`,
      detail: x.storeNames.get(o.store_id),
    });
  }

  // Group imports into batches per store+minute.
  const byBatch = new Map<string, { at: string; store: string; n: number }>();
  for (const s of x.sources) {
    const bucket = `${s.store_id}:${s.created_at.slice(0, 16)}`;
    const cur = byBatch.get(bucket);
    if (cur) cur.n++;
    else byBatch.set(bucket, { at: s.created_at, store: x.storeNames.get(s.store_id) ?? "a store", n: 1 });
  }
  for (const b of byBatch.values()) {
    events.push({ at: b.at, kind: "import", label: `Imported ${b.n} product${b.n === 1 ? "" : "s"}`, detail: b.store });
  }

  for (const a of x.ai.slice(0, 5)) {
    const label = FEATURE_LABEL[a.feature];
    if (label) events.push({ at: a.created_at, kind: "ai", label });
  }

  for (const s of x.stores.slice(0, 4)) {
    events.push({ at: s.created_at, kind: "store", label: `Created ${s.store_name}` });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function latestActionByStore(
  orders: OrderRow[],
  sources: SourceRow[],
  names: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, { at: string; label: string }>();
  const consider = (storeId: string, at: string, label: string) => {
    const cur = out.get(storeId);
    if (!cur || at > cur.at) out.set(storeId, { at, label });
  };
  for (const o of orders) consider(o.store_id, o.created_at, `Order · ${euros(o.amount_total)}`);
  for (const s of sources) consider(s.store_id, s.created_at, "Products imported");
  void names;
  const flat = new Map<string, string>();
  for (const [k, v] of out) flat.set(k, v.label);
  return flat;
}

// ── Moment ─────────────────────────────────────────────────────────────────
function buildMoment(x: {
  total: StoreStats;
  stats: Map<string, StoreStats>;
  sources: SourceRow[];
  now: Date;
}): Moment | null {
  // First-ever sales (all lifetime orders happened today).
  if (x.total.ordersTotal > 0 && x.total.ordersTotal === x.total.ordersToday) {
    return { emoji: "🎉", text: "Your first sales are in — congratulations." };
  }

  // A store clearly outperforming last week.
  let best: { name: string; up: number } | null = null;
  for (const st of x.stats.values()) {
    if (st.revenuePrev7dCents > 0) {
      const up = ((st.revenue7dCents - st.revenuePrev7dCents) / st.revenuePrev7dCents) * 100;
      if (up >= 10 && (!best || up > best.up)) best = { name: st.storeId, up };
    }
  }
  if (best) return { emoji: "🚀", text: `A store is outperforming last week by ${Math.round(best.up)}%.` };

  if (x.total.revenueTodayCents > 0) {
    return { emoji: "📈", text: `${euros(x.total.revenueTodayCents)} earned today and counting.` };
  }

  // New products imported in the last 24h.
  const recentImports = x.sources.filter((s) => x.now.getTime() - new Date(s.created_at).getTime() < 86_400_000).length;
  if (recentImports > 0) {
    return { emoji: "🔥", text: `${recentImports} new product${recentImports === 1 ? "" : "s"} added overnight.` };
  }

  return null;
}

// ── Briefing ───────────────────────────────────────────────────────────────
function buildBriefing(x: {
  greeting: string;
  fullName: string | null;
  total: StoreStats;
  stores: StoreRow[];
  stats: Map<string, StoreStats>;
  aiCount24h: number;
  opportunities: number;
}): Briefing {
  const first = x.fullName ? x.fullName.split(" ")[0] : null;
  const g = first ? `${x.greeting}, ${first}.` : `${x.greeting}.`;
  const lines: string[] = [];

  if (x.stores.length === 0) {
    lines.push("Your Command Center is ready. Generate your first store and watch it come to life.");
    return { greeting: g, lines };
  }

  if (x.total.revenueYesterdayCents > 0) {
    lines.push(`Yesterday your ${x.stores.length === 1 ? "store" : "stores"} generated ${euros(x.total.revenueYesterdayCents)}.`);
  } else if (x.total.revenueTotalCents === 0) {
    lines.push(`Your storefront is live and ready for its first sale.`);
  }

  if (x.aiCount24h > 0) {
    lines.push(`Urivo ran ${x.aiCount24h} AI ${x.aiCount24h === 1 ? "action" : "actions"} for you in the last 24 hours.`);
  }

  // Best weekly mover.
  let mover: number | null = null;
  for (const st of x.stats.values()) {
    if (st.revenuePrev7dCents > 0) {
      const up = ((st.revenue7dCents - st.revenuePrev7dCents) / st.revenuePrev7dCents) * 100;
      if (mover == null || up > mover) mover = up;
    }
  }
  if (mover != null && mover >= 5) lines.push(`One store is up ${Math.round(mover)}% versus last week.`);

  if (x.opportunities > 0) {
    lines.push(`You have ${x.opportunities} AI ${x.opportunities === 1 ? "recommendation" : "recommendations"} waiting.`);
  }

  if (lines.length === 0) lines.push("Everything's running smoothly. Here's where your business stands.");
  return { greeting: g, lines: lines.slice(0, 3) };
}

// ── Small utils ────────────────────────────────────────────────────────────
function countRecent(rows: { created_at: string }[], now: Date, windowMs: number): number {
  const cutoff = now.getTime() - windowMs;
  return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff).length;
}
