import "server-only";
import {
  SupplierError,
  type SupplierProvider,
  type SupplierConnection,
  type SearchQuery,
  type SupplierProduct,
  type SupplierProductPage,
  type SupplierVariant,
  type InventoryLevel,
  type PriceQuote,
  type ShippingDestination,
  type ShippingOption,
  type SupplierOrderRequest,
  type SupplierOrder,
  type Money,
} from "../types";

/*
 * AutoDS — reference provider (spec: first implementation).
 *
 * This file is the ONLY place that knows AutoDS's API exists. It normalises
 * AutoDS's shapes into Urivo's canonical types; the rest of the platform is
 * unaware of the vendor. Use it as the template for every future provider —
 * implement `SupplierProvider`, normalise into the canonical types, register it.
 *
 * ⚠️ Transport: endpoint paths and response field names below follow AutoDS's
 * Platform API and are isolated in the private `raw*` types + normalisers. When
 * you provision AutoDS partner credentials, confirm them against the live docs
 * and adjust ONLY this file — no other part of Urivo changes.
 */

const API_BASE = process.env.AUTODS_API_BASE || "https://platform-api.autods.com/v1";

// ── Vendor-shaped payloads (isolated here; normalised below) ─────────────────
interface RawVariant {
  id: string | number;
  title?: string;
  options?: Record<string, string>;
  cost?: number;
  price?: number; // vendor MSRP
  currency?: string;
  sku?: string;
  stock?: number;
  in_stock?: boolean;
  image?: string;
}
interface RawProduct {
  id: string | number;
  title: string;
  description?: string;
  images?: string[];
  category?: string;
  variants?: RawVariant[];
  currency?: string;
  shipping_days_min?: number;
  shipping_days_max?: number;
  ships_from?: string;
  supplier_rating?: number;
  refund_rate?: number;
  orders_count?: number;
  trend?: "declining" | "steady" | "rising" | "hot";
}

function money(amount: number | undefined, currency: string | undefined): Money {
  return { amount: amount ?? 0, currency: (currency || "USD").toUpperCase() };
}

function normalizeVariant(v: RawVariant, currency: string | undefined): SupplierVariant {
  return {
    externalVariantId: String(v.id),
    title: v.title || "Default",
    options: v.options ?? {},
    cost: money(v.cost, v.currency || currency),
    suggestedRetail: v.price != null ? money(v.price, v.currency || currency) : null,
    sku: v.sku ?? null,
    inStock: v.in_stock ?? (v.stock ?? 0) > 0,
    inventory: v.stock ?? null,
    imageUrl: v.image ?? null,
  };
}

function normalizeProduct(p: RawProduct): SupplierProduct {
  const variants = (p.variants ?? []).map((v) => normalizeVariant(v, p.currency));
  const fromCost = variants.reduce<Money>(
    (lo, v) => (v.cost.amount < lo.amount ? v.cost : lo),
    variants[0]?.cost ?? money(0, p.currency),
  );
  return {
    provider: "autods",
    externalProductId: String(p.id),
    title: p.title,
    description: p.description ?? null,
    images: p.images ?? [],
    category: p.category ?? null,
    variants,
    fromCost,
    suggestedRetail: variants[0]?.suggestedRetail ?? null,
    signals: {
      shippingDaysMin: p.shipping_days_min ?? null,
      shippingDaysMax: p.shipping_days_max ?? null,
      shipsFromCountry: p.ships_from ?? null,
      supplierRating: p.supplier_rating ?? null,
      refundRatePct: p.refund_rate ?? null,
      ordersCount: p.orders_count ?? null,
      categoryTrend: p.trend ?? null,
    },
    raw: p,
  };
}

async function autodsFetch<T>(conn: SupplierConnection, path: string, init?: RequestInit): Promise<T> {
  const token = conn.credentials.apiKey || conn.credentials.token;
  if (!token) throw new SupplierError("NOT_CONFIGURED", "AutoDS API key is missing.");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new SupplierError("PROVIDER_ERROR", `AutoDS request failed: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new SupplierError("AUTH_FAILED", "AutoDS rejected the credentials.");
  if (res.status === 429) throw new SupplierError("RATE_LIMITED", "AutoDS rate limit hit.");
  if (res.status === 404) throw new SupplierError("NOT_FOUND", "AutoDS resource not found.");
  if (!res.ok) throw new SupplierError("PROVIDER_ERROR", `AutoDS error ${res.status}.`);
  return (await res.json()) as T;
}

export const autodsProvider: SupplierProvider = {
  id: "autods",
  name: "AutoDS",
  credentialFields: [{ key: "apiKey", label: "AutoDS API key", secret: true }],

  isConfigured(conn) {
    return Boolean(conn.credentials.apiKey || conn.credentials.token);
  },

  async searchProducts(conn, query: SearchQuery): Promise<SupplierProductPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 24;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (query.term) params.set("q", query.term);
    if (query.category) params.set("category", query.category);
    if (query.shipsTo) params.set("ships_to", query.shipsTo);
    if (query.maxShippingDays) params.set("max_shipping_days", String(query.maxShippingDays));
    if (query.sort) params.set("sort", query.sort);
    const data = await autodsFetch<{ products?: RawProduct[]; total?: number }>(
      conn,
      `/products/search?${params.toString()}`,
    );
    const products = (data.products ?? []).map(normalizeProduct);
    return {
      products,
      page,
      pageSize,
      total: data.total ?? null,
      hasMore: data.total != null ? page * pageSize < data.total : products.length === pageSize,
    };
  },

  async getProduct(conn, externalProductId): Promise<SupplierProduct | null> {
    try {
      const p = await autodsFetch<RawProduct>(conn, `/products/${encodeURIComponent(externalProductId)}`);
      return normalizeProduct(p);
    } catch (e) {
      if (e instanceof SupplierError && e.code === "NOT_FOUND") return null;
      throw e;
    }
  },

  async syncInventory(conn, ids): Promise<InventoryLevel[]> {
    const data = await autodsFetch<{ items?: RawProduct[] }>(conn, `/inventory`, {
      method: "POST",
      body: JSON.stringify({ product_ids: ids }),
    });
    return (data.items ?? []).flatMap((p) =>
      (p.variants ?? []).map((v) => ({
        externalProductId: String(p.id),
        externalVariantId: String(v.id),
        inStock: v.in_stock ?? (v.stock ?? 0) > 0,
        inventory: v.stock ?? null,
      })),
    );
  },

  async syncPricing(conn, ids): Promise<PriceQuote[]> {
    const data = await autodsFetch<{ items?: RawProduct[] }>(conn, `/pricing`, {
      method: "POST",
      body: JSON.stringify({ product_ids: ids }),
    });
    return (data.items ?? []).flatMap((p) =>
      (p.variants ?? []).map((v) => ({
        externalProductId: String(p.id),
        externalVariantId: String(v.id),
        cost: money(v.cost, v.currency || p.currency),
        suggestedRetail: v.price != null ? money(v.price, v.currency || p.currency) : null,
      })),
    );
  },

  async getShipping(conn, externalProductId, to: ShippingDestination): Promise<ShippingOption[]> {
    const data = await autodsFetch<{ options?: { service: string; cost: number; currency?: string; eta_min: number; eta_max: number; tracked?: boolean }[] }>(
      conn,
      `/products/${encodeURIComponent(externalProductId)}/shipping?country=${to.country}${to.postalCode ? `&postal=${to.postalCode}` : ""}`,
    );
    return (data.options ?? []).map((o) => ({
      service: o.service,
      cost: money(o.cost, o.currency),
      etaDaysMin: o.eta_min,
      etaDaysMax: o.eta_max,
      tracked: o.tracked ?? true,
    }));
  },

  async createOrder(conn, order: SupplierOrderRequest): Promise<SupplierOrder> {
    const data = await autodsFetch<{ id: string | number; status?: string; tracking_number?: string; tracking_url?: string }>(
      conn,
      `/orders`,
      { method: "POST", body: JSON.stringify(order) },
    );
    return {
      externalOrderId: String(data.id),
      status: (data.status as SupplierOrder["status"]) || "placed",
      trackingNumber: data.tracking_number ?? null,
      trackingUrl: data.tracking_url ?? null,
    };
  },

  async getOrder(conn, externalOrderId): Promise<SupplierOrder | null> {
    try {
      const data = await autodsFetch<{ id: string | number; status?: string; tracking_number?: string; tracking_url?: string }>(
        conn,
        `/orders/${encodeURIComponent(externalOrderId)}`,
      );
      return {
        externalOrderId: String(data.id),
        status: (data.status as SupplierOrder["status"]) || "processing",
        trackingNumber: data.tracking_number ?? null,
        trackingUrl: data.tracking_url ?? null,
      };
    } catch (e) {
      if (e instanceof SupplierError && e.code === "NOT_FOUND") return null;
      throw e;
    }
  },
};
