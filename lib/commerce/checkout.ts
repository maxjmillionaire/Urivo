import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartItem, ValidatedCart, ValidatedLine } from "./types";
import { toCents } from "./types";

/*
 * Server-authoritative cart validation. The client sends only product ids and
 * quantities; this recomputes every price and total from the database and drops
 * anything invalid (unknown product, wrong store, out of stock). The result is
 * the ONLY source of truth for what Stripe charges.
 */

export interface StoreForCheckout {
  id: string;
  store_name: string;
  subdomain: string;
  currency: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
}

const MAX_QTY = 20;

export async function loadStoreForCheckout(
  admin: SupabaseClient,
  subdomain: string,
): Promise<StoreForCheckout | null> {
  const { data } = await admin
    .from("stores")
    .select("id, store_name, subdomain, currency, stripe_account_id, stripe_charges_enabled, is_active")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  return data as StoreForCheckout;
}

/**
 * Validate a client cart against the store's real catalogue. Prices come only
 * from the DB; quantities are clamped to available inventory and a sane max.
 */
export async function validateCart(
  admin: SupabaseClient,
  storeId: string,
  items: CartItem[],
  currency: string,
): Promise<ValidatedCart> {
  // De-duplicate + clamp quantities from the client.
  const wanted = new Map<string, number>();
  for (const item of items) {
    if (!item?.productId || typeof item.quantity !== "number") continue;
    const qty = Math.max(1, Math.min(MAX_QTY, Math.floor(item.quantity)));
    wanted.set(item.productId, Math.min(MAX_QTY, (wanted.get(item.productId) ?? 0) + qty));
  }
  if (wanted.size === 0) return { lines: [], subtotal: 0, currency };

  const { data: rows } = await admin
    .from("products")
    .select("id, title, price_eur, image_url, inventory_count")
    .eq("store_id", storeId)
    .in("id", [...wanted.keys()]);

  const lines: ValidatedLine[] = [];
  for (const p of rows ?? []) {
    const requested = wanted.get(p.id) ?? 0;
    const stock = typeof p.inventory_count === "number" ? p.inventory_count : MAX_QTY;
    const quantity = Math.min(requested, stock);
    if (quantity <= 0) continue; // out of stock — silently dropped, surfaced in UI
    const unitAmount = toCents(Number(p.price_eur));
    lines.push({
      productId: p.id,
      title: p.title,
      unitAmount,
      quantity,
      lineTotal: unitAmount * quantity,
      imageUrl: p.image_url ?? null,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return { lines, subtotal, currency };
}
