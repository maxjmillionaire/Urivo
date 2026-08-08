import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { parseTheme } from "@/lib/storefront";
import { getCreditBalance } from "@/lib/credits";
import { planName, entitledPlanKey } from "@/lib/plans";

/*
 * The business snapshot Ask Urivo reasons over.
 *
 * The assistant used to receive a brand name, a tagline, three hex codes and a
 * product list. Asked "why is nobody buying?" it could only guess — which is
 * exactly the question a founder opens it for, and exactly where a generic
 * chatbot would have done just as well.
 *
 * This gathers what Urivo actually knows: whether the store is published, how
 * many people have seen it, how many bought, what the money looks like, and
 * whether the merchant can even take a payment yet. That turns a guess into a
 * diagnosis, and it is the one thing a general-purpose assistant cannot do.
 *
 * Everything is read through the user's own Supabase client, so RLS is the
 * boundary: the snapshot can only ever contain this merchant's own data.
 */

export interface AssistantProduct {
  title: string;
  description: string | null;
  priceEUR: number;
}

export interface AssistantStore {
  id: string;
  name: string;
  subdomain: string;
  tagline: string | null;
  isLive: boolean;
  publishedAt: string | null;
  createdAt: string;
  palette: { background: string; ink: string; accent: string };
  fonts: { heading: string; body: string };
  personality: string;
  sections: string[];
  products: AssistantProduct[];
  productCount: number;
}

export interface AssistantMetrics {
  visits30d: number;
  visitors30d: number;
  orders30d: number;
  revenue30dEUR: number;
  ordersLifetime: number;
  revenueLifetimeEUR: number;
  /** Paid orders ÷ unique visitors over the last 30 days, as a percentage. */
  conversionPct: number | null;
}

export interface AssistantAccount {
  plan: string;
  credits: number;
  storeCount: number;
  /** Whether Stripe Connect can actually accept a payment for this merchant. */
  canTakePayments: boolean;
}

export interface AssistantContext {
  store: AssistantStore | null;
  metrics: AssistantMetrics | null;
  account: AssistantAccount;
  /**
   * The snapshot could not be read. Distinct from "there is nothing there" —
   * conflating the two makes the assistant state a falsehood as fact ("you
   * have no store") to a founder who has three.
   */
  unavailable?: boolean;
}

const DAY_MS = 86_400_000;
const cents = (n: number) => Math.round(n) / 100;

/**
 * Gather the snapshot for a user. Every section degrades independently: a
 * failed analytics query costs the assistant its numbers, never the whole
 * conversation.
 */
export async function loadAssistantContext(userId: string): Promise<AssistantContext> {
  const supabase = await supabaseServer();

  /*
   * `published_at` arrives with migration 0027, which an environment may not
   * have applied yet. Ask for it, and fall back to the columns that have
   * existed since 0001 rather than letting one optional column cost the
   * assistant its entire view of the business.
   */
  const CORE = "id, store_name, subdomain, is_active, theme_config, created_at";
  const loadStores = async () => {
    const full = await supabase
      .from("stores")
      .select(`${CORE}, published_at`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!full.error) return full;
    return supabase
      .from("stores")
      .select(CORE)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
  };

  const [storesResult, credits, { data: profile }] = await Promise.all([
    loadStores(),
    getCreditBalance(userId).catch(() => 0),
    supabase
      .from("profiles")
      .select("plan, subscription_status, comped_until, stripe_charges_enabled")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  /** Only the columns this module reads; `published_at` may be absent. */
  interface StoreRow {
    id: string;
    store_name: string;
    subdomain: string;
    is_active: boolean;
    theme_config: unknown;
    created_at: string;
    published_at?: string | null;
  }
  const stores = (storesResult.data ?? null) as StoreRow[] | null;

  const account: AssistantAccount = {
    plan: planName(entitledPlanKey(profile)),
    credits,
    storeCount: stores?.length ?? 0,
    canTakePayments: Boolean(profile?.stripe_charges_enabled),
  };

  // A failed read is reported as a failed read. Only an empty result set means
  // the founder genuinely has no store.
  if (storesResult.error) return { store: null, metrics: null, account, unavailable: true };
  if (!stores || stores.length === 0) return { store: null, metrics: null, account };

  // The live store is the one the founder means; otherwise their newest draft.
  const top = stores.find((s) => s.is_active) ?? stores[0];
  /*
   * Read the FULL design system when the store has one. Going through the
   * legacy theme shape instead silently flattens it — the assistant then reads
   * back a default page order, default fonts and no personality, and states
   * them to the founder as fact about their own store.
   */
  const config = (top.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(top.theme_config));
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();

  // Analytics are best-effort: a failed metrics query costs the assistant its
  // numbers (and it will say so), never the whole conversation.
  const loadVisits = async (): Promise<{ session_hash: string }[]> => {
    try {
      const { data } = await supabase
        .from("store_visits")
        .select("session_hash")
        .eq("store_id", top.id)
        .gte("created_at", since)
        .limit(5000);
      return data ?? [];
    } catch {
      return [];
    }
  };
  const loadOrders = async (): Promise<{ amount_total: number; created_at: string }[]> => {
    try {
      const { data } = await supabase
        .from("orders")
        .select("amount_total, created_at")
        .eq("store_id", top.id)
        .eq("status", "paid");
      return data ?? [];
    } catch {
      return [];
    }
  };

  const [{ data: products, count: productCount }, visits, orders] = await Promise.all([
    supabase
      .from("products")
      .select("title, description, price_eur", { count: "exact" })
      .eq("store_id", top.id)
      .order("position", { ascending: true })
      .limit(12),
    loadVisits(),
    loadOrders(),
  ]);

  const store: AssistantStore = {
    id: top.id,
    name: top.store_name,
    subdomain: top.subdomain,
    tagline: ds.tagline ?? null,
    isLive: top.is_active,
    publishedAt: typeof top.published_at === "string" ? top.published_at : null,
    createdAt: top.created_at,
    palette: { background: ds.palette.background, ink: ds.palette.ink, accent: ds.palette.accent },
    fonts: { heading: ds.fonts.headingKey, body: ds.fonts.bodyKey },
    personality: ds.personality,
    sections: ds.narrative?.length
      ? ds.narrative.map((b) => b.kind)
      : ds.layout.sectionOrder.slice(),
    products: (products ?? []).map((p) => ({
      title: p.title,
      description: p.description,
      priceEUR: Number(p.price_eur),
    })),
    productCount: productCount ?? products?.length ?? 0,
  };

  const recent = orders.filter((o) => o.created_at >= since);
  const visitors = new Set(visits.map((v) => v.session_hash)).size;
  const metrics: AssistantMetrics = {
    visits30d: visits.length,
    visitors30d: visitors,
    orders30d: recent.length,
    revenue30dEUR: cents(recent.reduce((s, o) => s + (o.amount_total ?? 0), 0)),
    ordersLifetime: orders.length,
    revenueLifetimeEUR: cents(orders.reduce((s, o) => s + (o.amount_total ?? 0), 0)),
    conversionPct: visitors > 0 ? Math.round((recent.length / visitors) * 1000) / 10 : null,
  };

  return { store, metrics, account };
}

/**
 * Render the snapshot for the model.
 *
 * Written as plain, unambiguous statements — including the negative ones. "0
 * visits" and "not published" are the most useful facts on the page, because
 * they let the assistant name the real problem instead of writing copy for a
 * store nobody has ever loaded.
 */
export function renderContext(ctx: AssistantContext): string {
  const lines: string[] = [];
  const { store, metrics, account } = ctx;

  lines.push(
    `Account: ${account.plan} plan · ${account.credits} credits · ${account.storeCount} store${account.storeCount === 1 ? "" : "s"}`,
  );
  lines.push(
    account.canTakePayments
      ? "Payments: Stripe connected — this merchant can accept money."
      : "Payments: NOT connected. Stripe onboarding is unfinished, so this store cannot accept a payment yet, no matter how much traffic it gets.",
  );

  if (ctx.unavailable) {
    lines.push(
      "",
      "Their store data could NOT be loaded for this message. You are working blind. Do not state or imply that they have no store, no products or no traffic — you cannot see it, which is a different thing. Say plainly that you can't read their store right now, answer what you can from general expertise, and offer to look again.",
    );
    return lines.join("\n");
  }

  if (!store) {
    lines.push(
      "",
      "No store yet — this account genuinely has none. Help the founder shape their first one: positioning, audience, name direction, opening catalogue. Do not speak as though a store exists.",
    );
    return lines.join("\n");
  }

  const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(store.createdAt)) / DAY_MS));
  lines.push(
    "",
    `Store: ${store.name}${store.tagline ? ` — "${store.tagline}"` : ""}`,
    `Address: ${store.subdomain}.urivo.ai`,
    store.isLive
      ? `Status: LIVE${store.publishedAt ? `, published ${new Date(store.publishedAt).toISOString().slice(0, 10)}` : ""}`
      : "Status: DRAFT — not published, so the public cannot reach it. Nothing else matters until this is live.",
    `Created: ${ageDays} day${ageDays === 1 ? "" : "s"} ago`,
    `Art direction: ${store.personality} · background ${store.palette.background}, ink ${store.palette.ink}, accent ${store.palette.accent} · ${store.fonts.heading}/${store.fonts.body}`,
    `Page order: ${store.sections.join(" → ")}`,
  );

  lines.push("", `Catalogue (${store.productCount} product${store.productCount === 1 ? "" : "s"}):`);
  if (store.products.length === 0) {
    lines.push("  (empty — there is nothing to buy)");
  } else {
    store.products.forEach((p, i) => {
      lines.push(`  [${i}] ${p.title} — €${p.priceEUR.toFixed(2)}${p.description ? `: ${p.description}` : ""}`);
    });
    if (store.productCount > store.products.length) {
      lines.push(`  … and ${store.productCount - store.products.length} more`);
    }
  }

  if (metrics) {
    lines.push(
      "",
      "Performance — these are REAL measured numbers, use them and never invent others:",
      `  Last 30 days: ${metrics.visits30d} page views from ${metrics.visitors30d} visitors · ${metrics.orders30d} paid orders · €${metrics.revenue30dEUR.toFixed(2)}`,
      `  Lifetime: ${metrics.ordersLifetime} paid orders · €${metrics.revenueLifetimeEUR.toFixed(2)}`,
      metrics.conversionPct === null
        ? "  Conversion: no visitors yet, so there is no conversion rate to read."
        : `  Conversion: ${metrics.conversionPct}% of visitors bought.`,
    );
    if (metrics.visitors30d === 0) {
      lines.push(
        "  DIAGNOSIS: nobody has visited. This is a traffic problem, not a store problem — do not suggest conversion tweaks as the fix.",
      );
    } else if (metrics.ordersLifetime === 0) {
      lines.push(
        `  DIAGNOSIS: ${metrics.visitors30d} visitors and still no first sale. The gap is between arriving and buying.`,
      );
    }
  }

  return lines.join("\n");
}
