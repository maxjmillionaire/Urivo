import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { getPlanForUser } from "@/lib/plan-access";
import { optimizeProductCopy } from "@/lib/ai/product-optimizer";
import { getConnection, toEur } from "./import";
import { landedCostEur, marginAfterDuty } from "@/lib/finance/import-duty";
import { getSupplierProvider } from "./registry";
import { scoreSupplierProduct, type UrivoScore } from "./scoring";
import { learnedSignalsForMany, recordProductOutcome } from "./intelligence";
import { selectRun, recordRun, type RunArms } from "@/lib/intelligence/decisions";
import type { CopyStyle } from "@/lib/ai/product-optimizer";
import { SupplierError, type SupplierProviderId, type SupplierProduct, type Money } from "./types";

/*
 * Auto-source autopilot — "Generate → Done".
 *
 * Takes a freshly generated store (whose AI-invented catalogue is the shopping
 * list) and turns it into a REAL business: for each intended product it searches
 * the connected supplier, scores candidates with the Urivo Score (public signals
 * blended with Merchant Intelligence), picks the best, replaces the placeholders
 * with real products, rewrites copy on-brand, sets margin-aware prices, groups
 * collections and publishes. No user decisions required.
 *
 * Transparent + safe by design: it returns a full Decision report (what it chose
 * and WHY) so the user can intervene only on disagreement, and it declines
 * gracefully (keeping the generated catalogue) rather than shipping a weak store.
 */

const DEFAULTS = { targetCount: 8, minScore: 55, targetMarginPct: 0.65, minMarginPct: 0.45 };

export interface AutopilotOptions {
  targetCount?: number;
  minScore?: number;
  targetMarginPct?: number;
  publish?: boolean; // default true (if the plan can publish)
  optimizeCopy?: boolean; // default true (if AI configured)
  shipsTo?: string; // destination for the shipping signal, default "DE"
}

export interface ChosenProduct {
  externalProductId: string;
  externalVariantId: string | null;
  title: string;
  category: string;
  collection: string;
  costEur: number;
  priceEur: number;
  marginPct: number;
  score: number;
  stars: number;
  reasons: string[];
}

export interface AutopilotResult {
  ran: boolean;
  reason?: "not_connected" | "insufficient_matches" | "store_not_found";
  chosen: ChosenProduct[];
  skippedLowScore: number;
  collections: string[];
  published: boolean;
  /** The strategy (bandit arms) this run used — every one is a logged experiment. */
  strategy?: RunArms;
}

function charm(n: number): number {
  const r = Math.round(n);
  return r >= 2 ? r - 0.01 : Math.max(0.99, Math.round(n * 100) / 100);
}

/** Pricing strategy per bandit arm — each is a real, measurable experiment. */
function priceByArm(arm: string, costEur: number, intentPriceEur: number | null, opts: typeof DEFAULTS): number {
  switch (arm) {
    case "margin_60":
      return charm(Math.max(costEur / 0.4, costEur * 1.8, 0.99));
    case "margin_68":
      return charm(Math.max(costEur / 0.32, costEur * 1.8, 0.99));
    case "premium":
      return charm(Math.max(costEur * 2.2, (intentPriceEur ?? 0) * 1.15, costEur / 0.28, 0.99));
    case "anchor_intent":
    default:
      // Respect the brand's intended price when it clears min margin; else 65%.
      if (intentPriceEur && costEur > 0 && (intentPriceEur - costEur) / intentPriceEur >= opts.minMarginPct) {
        return charm(intentPriceEur);
      }
      return charm(Math.max(costEur / (1 - opts.targetMarginPct), costEur * 1.8, 0.99));
  }
}

interface Prepared {
  cand: Candidate;
  variantId: string | null;
  inventory: number | null;
  cost: Money;
  costEur: number;
  priceEur: number;
  marginPct: number;
  category: string;
  images: string[];
  rawTitle: string;
  rawDescription: string | null;
}

/** Hero-selection strategy per bandit arm → index of the hero in the list. */
function heroIndex(arm: string, prepared: Prepared[]): number {
  if (prepared.length === 0) return 0;
  if (arm === "first_intent") return 0; // keep the brand's generated order
  if (arm === "top_margin")
    return prepared.reduce((bi, p, i, a) => (p.marginPct > a[bi].marginPct ? i : bi), 0);
  return prepared.reduce((bi, p, i, a) => (p.cand.score.score > a[bi].cand.score.score ? i : bi), 0);
}

const SELECTION_MIN: Record<string, number> = { min50: 50, min60: 60, min68: 68 };

interface Candidate {
  product: SupplierProduct;
  variantId: string | null;
  score: UrivoScore;
  intentPriceEur: number | null;
}

export async function autoSourceStore(
  userId: string,
  storeId: string,
  provider: SupplierProviderId,
  options: AutopilotOptions = {},
): Promise<AutopilotResult> {
  const opts = { ...DEFAULTS, ...options };
  const empty = (reason: AutopilotResult["reason"]): AutopilotResult => ({
    ran: false, reason, chosen: [], skippedLowScore: 0, collections: [], published: false,
  });

  // Connection (decline cleanly if the supplier isn't linked).
  let conn;
  try {
    conn = await getConnection(userId, provider);
  } catch {
    return empty("not_connected");
  }
  const prov = getSupplierProvider(provider);
  const admin = supabaseAdmin();

  // Store + brand + the generated catalogue (our shopping list).
  const { data: store } = await admin
    .from("stores")
    .select("id, store_name, theme_config")
    .eq("id", storeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!store) return empty("store_not_found");

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));

  const { data: intentRows } = await admin
    .from("products")
    .select("id, title, price_eur")
    .eq("store_id", storeId)
    .order("position", { ascending: true });
  const intents = (intentRows ?? []).slice(0, opts.targetCount);
  if (intents.length === 0) return empty("insufficient_matches");

  // Decision Intelligence: pick the strategy (bandit arms) for this niche.
  const niche = ds.personality;
  const arms = await selectRun(niche);
  const minScore = SELECTION_MIN[arms.selection] ?? opts.minScore;

  // ── Search + score each intent, pick the best real match ─────────────────
  const chosen: Candidate[] = [];
  const takenIds = new Set<string>();
  let skippedLowScore = 0;

  for (const intent of intents) {
    let results: SupplierProduct[] = [];
    try {
      const page = await prov.searchProducts(conn, { term: intent.title, shipsTo: opts.shipsTo ?? "DE", pageSize: 10 });
      results = page.products;
    } catch {
      continue;
    }
    if (results.length === 0) continue;

    const intentPrice: Money = { amount: Number(intent.price_eur), currency: "EUR" };
    const learned = await learnedSignalsForMany(provider, results.map((r) => r.externalProductId));

    const ranked = results
      .filter((r) => !takenIds.has(r.externalProductId))
      .map((product) => ({
        product,
        score: scoreSupplierProduct(product, intentPrice, learned.get(product.externalProductId) ?? null),
      }))
      .sort((a, b) => b.score.score - a.score.score);

    const best = ranked[0];
    if (!best) continue;
    if (best.score.score < minScore) {
      skippedLowScore++;
      continue;
    }
    takenIds.add(best.product.externalProductId);
    chosen.push({
      product: best.product,
      variantId: best.product.variants[0]?.externalVariantId ?? null,
      score: best.score,
      intentPriceEur: Number(intent.price_eur),
    });
  }

  // Decline rather than ship a weak store — keep the generated catalogue.
  if (chosen.length < Math.max(3, Math.ceil(intents.length / 2))) {
    return { ...empty("insufficient_matches"), skippedLowScore };
  }

  // ── Pre-compute cost + price (pricing experiment) ────────────────────────
  const prepared: Prepared[] = chosen.map((cand) => {
    const variant = cand.product.variants.find((v) => v.externalVariantId === cand.variantId) ?? cand.product.variants[0];
    const cost = variant?.cost ?? cand.product.fromCost;
    const costEur = Math.round(toEur(cost) * 100) / 100;
    /*
     * Price and margin are computed against LANDED cost, not the supplier's
     * price. The EU's €150 duty exemption ended on 1 July 2026, so a non-EU
     * parcel now carries a flat customs charge per line item — €3, and €5 once
     * the handling fee joins it in November. On the cheap products this
     * autopilot is most likely to pick, that charge IS the margin: an €8 item
     * sold at €24 is 67% before duty and 46% after.
     *
     * Pricing off supplier cost would let every arm hit its margin target on
     * paper while the merchant sells at a fraction of it — or, below roughly
     * €10, at a loss. The origin comes from the supplier's own shipping signal;
     * unknown counts as an import, which is the direction that cannot bankrupt
     * anyone.
     */
    const dutyInput = {
      shipsFromCountry: cand.product.signals?.shipsFromCountry ?? null,
      shipsToCountry: opts.shipsTo,
    };
    const landedEur = Math.round(landedCostEur(costEur, dutyInput) * 100) / 100;
    const priceEur = priceByArm(arms.pricing, landedEur, cand.intentPriceEur, opts);
    const trueMargin = marginAfterDuty(priceEur, costEur, dutyInput);
    const marginPct = trueMargin != null ? Math.round(trueMargin * 100) : 0;
    return {
      cand, variantId: variant?.externalVariantId ?? null, inventory: variant?.inventory ?? null,
      cost, costEur, priceEur, marginPct,
      category: cand.product.category ?? "Featured",
      images: cand.product.images.length ? cand.product.images : variant?.imageUrl ? [variant.imageUrl] : [],
      rawTitle: cand.product.title, rawDescription: cand.product.description,
    };
  });

  // ── Hero experiment: move the chosen hero to position 0 ──────────────────
  const hi = heroIndex(arms.hero, prepared);
  if (hi > 0) prepared.unshift(prepared.splice(hi, 1)[0]);

  // ── On-brand copy in the chosen voice (copy_style experiment) ────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let optimized: { title: string; description: string }[] | null = null;
  if ((options.optimizeCopy ?? true) && apiKey) {
    try {
      const res = await optimizeProductCopy(
        apiKey,
        { name: store.store_name, tagline: ds.tagline ?? "", personality: ds.personality },
        prepared.map((p) => ({ title: p.rawTitle, description: p.rawDescription })),
        arms.copy_style as CopyStyle,
      );
      optimized = res.products;
    } catch {
      optimized = null; // keep raw copy
    }
  }

  // ── Replace the placeholder catalogue with the real products ─────────────
  await admin.from("products").delete().eq("store_id", storeId);

  const result: ChosenProduct[] = [];
  const collectionsSet = new Set<string>();

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const title = optimized?.[i]?.title ?? p.rawTitle;
    const description = optimized?.[i]?.description ?? p.rawDescription ?? "";
    const collection = p.category;
    collectionsSet.add(collection);

    const { data: created } = await admin
      .from("products")
      .insert({
        store_id: storeId,
        title,
        description,
        price_eur: p.priceEur,
        image_url: p.images[0] ?? null,
        image_source: p.images[0] ? "supplier" : null,
        inventory_count: Math.max(0, p.inventory ?? 100),
        position: i,
      })
      .select("id")
      .single();
    if (!created) continue;

    await admin.from("product_sources").insert({
      product_id: created.id,
      store_id: storeId,
      user_id: userId,
      provider,
      external_product_id: p.cand.product.externalProductId,
      external_variant_id: p.variantId,
      supplier_cost_eur: p.costEur,
      supplier_currency: p.cost.currency,
      supplier_cost_original: Math.round(p.cost.amount * 100) / 100,
      sync_status: "synced",
      last_synced_at: new Date().toISOString(),
      raw: (p.cand.product.raw ?? null) as object | null,
    });

    await recordProductOutcome({
      provider, externalProductId: p.cand.product.externalProductId, event: "import",
      category: collection, niche: ds.personality, storeId,
    });

    result.push({
      externalProductId: p.cand.product.externalProductId,
      externalVariantId: p.variantId,
      title, category: p.category, collection, costEur: p.costEur, priceEur: p.priceEur, marginPct: p.marginPct,
      score: p.cand.score.score, stars: p.cand.score.stars, reasons: p.cand.score.reasons,
    });
  }

  // ── Log every decision as an experiment for this store ───────────────────
  await recordRun(storeId, userId, niche, arms, { chosen: result.length });

  // ── Publish (if the plan allows) ─────────────────────────────────────────
  let published = false;
  if ((options.publish ?? true)) {
    const plan = await getPlanForUser(userId);
    if (plan.features.publish) {
      await admin.from("stores").update({ is_active: true }).eq("id", storeId);
      published = true;
    }
  }

  return {
    ran: true,
    chosen: result,
    skippedLowScore,
    collections: [...collectionsSet],
    published,
  };
}

export { SupplierError };
