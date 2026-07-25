import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { getPlanForUser } from "@/lib/plan-access";
import { optimizeProductCopy } from "@/lib/ai/product-optimizer";
import { getConnection, toEur } from "./import";
import { getSupplierProvider } from "./registry";
import { scoreSupplierProduct, type UrivoScore } from "./scoring";
import { learnedSignalsForMany, recordProductOutcome } from "./intelligence";
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
}

function charm(n: number): number {
  const r = Math.round(n);
  return r >= 2 ? r - 0.01 : Math.max(0.99, Math.round(n * 100) / 100);
}

/** Respect the brand's intended price when it clears the minimum margin; else
 *  price up from cost to the target margin. Always charm-rounded. */
function smartPrice(costEur: number, intentPriceEur: number | null, opts: typeof DEFAULTS): number {
  if (intentPriceEur && costEur > 0 && (intentPriceEur - costEur) / intentPriceEur >= opts.minMarginPct) {
    return charm(intentPriceEur);
  }
  const raw = costEur / (1 - opts.targetMarginPct);
  return charm(Math.max(raw, costEur * 1.8, 0.99));
}

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
    if (best.score.score < opts.minScore) {
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

  // ── On-brand copy (best-effort) ──────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let optimized: { title: string; description: string }[] | null = null;
  if ((options.optimizeCopy ?? true) && apiKey) {
    try {
      const res = await optimizeProductCopy(
        apiKey,
        { name: store.store_name, tagline: ds.tagline ?? "", personality: ds.personality },
        chosen.map((c) => ({ title: c.product.title, description: c.product.description })),
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
  let position = 0;

  for (let i = 0; i < chosen.length; i++) {
    const c = chosen[i];
    const variant = c.product.variants.find((v) => v.externalVariantId === c.variantId) ?? c.product.variants[0];
    const cost = variant?.cost ?? c.product.fromCost;
    const costEur = Math.round(toEur(cost) * 100) / 100;
    const priceEur = smartPrice(costEur, c.intentPriceEur, opts);
    const marginPct = priceEur > 0 ? Math.round(((priceEur - costEur) / priceEur) * 100) : 0;
    const title = optimized?.[i]?.title ?? c.product.title;
    const description = optimized?.[i]?.description ?? c.product.description ?? "";
    const category = c.product.category ?? "Featured";
    const collection = category;
    collectionsSet.add(collection);
    const imageUrl = c.product.images[0] ?? variant?.imageUrl ?? null;

    const { data: created } = await admin
      .from("products")
      .insert({
        store_id: storeId,
        title,
        description,
        price_eur: priceEur,
        image_url: imageUrl,
        inventory_count: Math.max(0, variant?.inventory ?? 100),
        position: position++,
      })
      .select("id")
      .single();
    if (!created) continue;

    await admin.from("product_sources").insert({
      product_id: created.id,
      store_id: storeId,
      user_id: userId,
      provider,
      external_product_id: c.product.externalProductId,
      external_variant_id: variant?.externalVariantId ?? null,
      supplier_cost_eur: costEur,
      supplier_currency: cost.currency,
      supplier_cost_original: Math.round(cost.amount * 100) / 100,
      sync_status: variant?.inStock === false ? "out_of_stock" : "synced",
      last_synced_at: new Date().toISOString(),
      raw: (c.product.raw ?? null) as object | null,
    });

    // Merchant Intelligence: a real merchant just imported this product.
    await recordProductOutcome({
      provider, externalProductId: c.product.externalProductId, event: "import",
      category, niche: ds.personality, storeId,
    });

    result.push({
      externalProductId: c.product.externalProductId,
      externalVariantId: variant?.externalVariantId ?? null,
      title, category, collection, costEur, priceEur, marginPct,
      score: c.score.score, stars: c.score.stars, reasons: c.score.reasons,
    });
  }

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
