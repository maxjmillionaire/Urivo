import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usdToEur } from "@/lib/finance/cost-model";
import { getSupplierProvider } from "./registry";
import { rankByUrivoScore, type UrivoScore } from "./scoring";
import {
  SupplierError,
  type SupplierConnection,
  type SupplierProviderId,
  type SupplierProduct,
  type SearchQuery,
  type Money,
} from "./types";

/*
 * Sourcing orchestration — the platform's entry point to the supplier layer.
 * Everything here is provider-agnostic: it resolves a provider from the registry
 * and works entirely in canonical types. This is what the API routes and the
 * post-generation "suggest products" flow call.
 */

// Retail markup applied when a supplier gives no suggested retail price.
const DEFAULT_MARKUP = 2.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Convert a supplier amount into EUR (the accounting/display currency). */
export function toEur(m: Money): number {
  if (m.currency === "EUR") return m.amount;
  if (m.currency === "USD") return usdToEur(m.amount);
  return m.amount; // unknown currency: pass through (FX to be added per currency)
}

// ── Connections ──────────────────────────────────────────────────────────────

export async function getConnection(
  userId: string,
  provider: SupplierProviderId,
): Promise<SupplierConnection> {
  const { data } = await supabaseAdmin()
    .from("supplier_connections")
    .select("id, user_id, provider, label, credentials, status")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) throw new SupplierError("NOT_CONFIGURED", `No ${provider} connection for this account.`);
  return {
    id: data.id,
    userId: data.user_id,
    provider: data.provider,
    label: data.label,
    credentials: (data.credentials ?? {}) as Record<string, string>,
    status: data.status,
  };
}

/** Connection status per provider — never returns credentials. */
export async function listConnections(
  userId: string,
): Promise<{ provider: SupplierProviderId; label: string; status: string }[]> {
  const { data } = await supabaseAdmin()
    .from("supplier_connections")
    .select("provider, label, status")
    .eq("user_id", userId);
  return (data ?? []) as { provider: SupplierProviderId; label: string; status: string }[];
}

/** Create or update a connection's credentials (upsert on user+provider). */
export async function saveConnection(
  userId: string,
  provider: SupplierProviderId,
  credentials: Record<string, string>,
  label = "",
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("supplier_connections")
    .upsert(
      { user_id: userId, provider, credentials, label, status: "active" },
      { onConflict: "user_id,provider" },
    );
  if (error) throw new SupplierError("PROVIDER_ERROR", `Could not save connection: ${error.message}`);
}

// ── Suggestions (search + Urivo Score) ───────────────────────────────────────

export interface ScoredSuggestion {
  product: SupplierProduct;
  score: UrivoScore;
  retailEur: number;
  costEur: number;
}

/**
 * Search a connected supplier and return products ranked by the Urivo Score.
 * `targetRetail` (Urivo's intended selling price, e.g. from the generated
 * catalogue) sharpens the margin signal; without it the vendor MSRP is used.
 */
export async function suggestProducts(
  userId: string,
  provider: SupplierProviderId,
  query: SearchQuery,
  targetRetail?: (p: SupplierProduct) => Money | null | undefined,
): Promise<ScoredSuggestion[]> {
  const conn = await getConnection(userId, provider);
  const prov = getSupplierProvider(provider);
  const page = await prov.searchProducts(conn, query);
  return rankByUrivoScore(page.products, targetRetail).map(({ product, score }) => {
    const retail = targetRetail?.(product) ?? product.suggestedRetail ?? null;
    return {
      product,
      score,
      costEur: round2(toEur(product.fromCost)),
      retailEur: retail ? round2(toEur(retail)) : round2(toEur(product.fromCost) * DEFAULT_MARKUP),
    };
  });
}

// ── Import (one click → configured product pages) ────────────────────────────

export interface ImportSelection {
  externalProductId: string;
  externalVariantId?: string;
}

export interface ImportedProduct {
  productId: string;
  title: string;
  priceEur: number;
  costEur: number;
}

/**
 * Import selected supplier products into a store: fetches full detail from the
 * provider, normalises it, writes a Urivo product (title, description, image,
 * retail price, stock) and a product_sources row (supplier origin + cost) that
 * powers later inventory/price/order sync. Best-effort per item — a failing
 * product is skipped, the rest import.
 */
export async function importProducts(
  userId: string,
  storeId: string,
  provider: SupplierProviderId,
  selections: ImportSelection[],
): Promise<ImportedProduct[]> {
  const conn = await getConnection(userId, provider);
  const prov = getSupplierProvider(provider);
  const admin = supabaseAdmin();

  const { data: store } = await admin
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!store) throw new SupplierError("NOT_FOUND", "Store not found for this account.");

  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId);
  let position = count ?? 0;

  const imported: ImportedProduct[] = [];
  for (const sel of selections) {
    let product: SupplierProduct | null;
    try {
      product = await prov.getProduct(conn, sel.externalProductId);
    } catch {
      continue; // skip a failing item; import the rest
    }
    if (!product) continue;

    const variant = sel.externalVariantId
      ? product.variants.find((v) => v.externalVariantId === sel.externalVariantId)
      : product.variants[0];
    const cost = variant?.cost ?? product.fromCost;
    const costEur = round2(toEur(cost));
    const suggested = variant?.suggestedRetail ?? product.suggestedRetail ?? null;
    const retailEur = Math.max(0.5, round2(suggested ? toEur(suggested) : costEur * DEFAULT_MARKUP));
    const imageUrl = product.images[0] ?? variant?.imageUrl ?? null;

    const { data: created, error } = await admin
      .from("products")
      .insert({
        store_id: storeId,
        title: product.title,
        description: product.description ?? "",
        price_eur: retailEur,
        image_url: imageUrl,
        inventory_count: Math.max(0, variant?.inventory ?? 100),
        position: position++,
      })
      .select("id")
      .single();
    if (error || !created) continue;

    await admin.from("product_sources").insert({
      product_id: created.id,
      store_id: storeId,
      user_id: userId,
      provider,
      external_product_id: product.externalProductId,
      external_variant_id: variant?.externalVariantId ?? null,
      supplier_cost_eur: costEur,
      supplier_currency: cost.currency,
      supplier_cost_original: round2(cost.amount),
      sync_status: variant?.inStock === false ? "out_of_stock" : "synced",
      last_synced_at: new Date().toISOString(),
      raw: (product.raw ?? null) as object | null,
    });

    imported.push({ productId: created.id, title: product.title, priceEur: retailEur, costEur });
  }

  return imported;
}
