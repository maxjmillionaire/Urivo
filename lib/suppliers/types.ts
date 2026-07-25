/*
 * Supplier Integration Layer — canonical domain + provider contract.
 *
 * Urivo talks ONLY to the `SupplierProvider` interface, never to a specific
 * vendor. Every provider (AutoDS, CJ, Zendrop, DSers, Spocket, Printful,
 * Printify, …) normalises its own API into the canonical shapes below, so the
 * rest of the codebase — import pipeline, storefront, order sync, the Urivo
 * Score — is provider-agnostic. Adding a vendor = one new file implementing this
 * interface + one registry line. Nothing else changes.
 *
 * Isomorphic (no server-only imports): the UI renders canonical products +
 * scores directly from these types.
 */

export type SupplierProviderId =
  | "autods"
  | "cj"
  | "zendrop"
  | "dsers"
  | "spocket"
  | "printful"
  | "printify";

/** A monetary amount in its source currency (converted to EUR at import). */
export interface Money {
  amount: number;
  currency: string; // ISO 4217, e.g. "USD", "EUR"
}

/** One purchasable variant of a supplier product (size/colour/etc.). */
export interface SupplierVariant {
  externalVariantId: string;
  title: string; // e.g. "Black / L"
  options: Record<string, string>; // { Colour: "Black", Size: "L" }
  cost: Money; // what Urivo's merchant pays the supplier
  suggestedRetail?: Money | null; // vendor MSRP if provided
  sku?: string | null;
  inStock: boolean;
  inventory?: number | null;
  imageUrl?: string | null;
}

/** Vendor-side signals used by the Urivo Score. All optional — providers fill
 *  what they expose; the score degrades gracefully when a signal is missing. */
export interface SupplierSignals {
  shippingDaysMin?: number | null;
  shippingDaysMax?: number | null;
  shipsFromCountry?: string | null; // ISO-2, e.g. "DE", "CN"
  supplierRating?: number | null; // 0–5
  refundRatePct?: number | null; // 0–100 (lower is better)
  ordersCount?: number | null; // vendor sales volume (popularity)
  categoryTrend?: "declining" | "steady" | "rising" | "hot" | null;
}

/** A product as Urivo understands it, regardless of source vendor. */
export interface SupplierProduct {
  provider: SupplierProviderId;
  externalProductId: string;
  title: string;
  description: string | null;
  images: string[];
  category?: string | null;
  variants: SupplierVariant[];
  /** Lowest variant cost — convenience for cards/scoring. */
  fromCost: Money;
  suggestedRetail?: Money | null;
  signals: SupplierSignals;
  /** Raw vendor payload, kept for debugging + future fields. Never rendered. */
  raw?: unknown;
}

export interface SearchQuery {
  term?: string;
  category?: string;
  minMarginPct?: number;
  shipsTo?: string; // ISO-2 destination
  maxShippingDays?: number;
  sort?: "relevance" | "margin" | "shipping" | "popularity";
  page?: number;
  pageSize?: number;
}

export interface SupplierProductPage {
  products: SupplierProduct[];
  page: number;
  pageSize: number;
  total?: number | null;
  hasMore: boolean;
}

/** Live inventory for one variant (sync). */
export interface InventoryLevel {
  externalProductId: string;
  externalVariantId: string;
  inStock: boolean;
  inventory: number | null;
}

/** Live cost/price for one variant (sync). */
export interface PriceQuote {
  externalProductId: string;
  externalVariantId: string;
  cost: Money;
  suggestedRetail?: Money | null;
}

export interface ShippingDestination {
  country: string; // ISO-2
  postalCode?: string;
}

export interface ShippingOption {
  service: string; // "Standard", "Express", …
  cost: Money;
  etaDaysMin: number;
  etaDaysMax: number;
  tracked: boolean;
}

/** A line to fulfil through the supplier. */
export interface SupplierOrderLine {
  externalProductId: string;
  externalVariantId: string;
  quantity: number;
}

export interface SupplierOrderRequest {
  reference: string; // Urivo order id
  lines: SupplierOrderLine[];
  shipTo: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string; // ISO-2
    phone?: string;
    email?: string;
  };
}

export type SupplierOrderStatus =
  | "pending"
  | "placed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed";

export interface SupplierOrder {
  externalOrderId: string;
  status: SupplierOrderStatus;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  cost?: Money | null;
}

/**
 * Per-user connection to a provider (credentials + metadata). The credentials
 * shape is provider-specific; the layer treats it opaquely and hands it to the
 * matching provider. Stored server-side only (never exposed to the browser).
 */
export interface SupplierConnection {
  id: string;
  userId: string;
  provider: SupplierProviderId;
  label: string;
  credentials: Record<string, string>;
  status: "active" | "disconnected" | "error";
}

/** Raised by providers so the API layer can map to clean HTTP responses. */
export class SupplierError extends Error {
  constructor(
    public code:
      | "NOT_CONFIGURED"
      | "AUTH_FAILED"
      | "RATE_LIMITED"
      | "NOT_FOUND"
      | "UNSUPPORTED"
      | "PROVIDER_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

/**
 * THE CONTRACT. Every supplier implements exactly this. Urivo never imports a
 * concrete provider — it resolves one from the registry and calls this shape.
 *
 * Methods take the caller's SupplierConnection so a single provider instance is
 * stateless and safe to share across users. Any capability a vendor genuinely
 * lacks throws SupplierError("UNSUPPORTED") rather than faking data.
 */
export interface SupplierProvider {
  readonly id: SupplierProviderId;
  readonly name: string;
  /** Which credential keys this provider needs (for the connect UI). */
  readonly credentialFields: { key: string; label: string; secret: boolean }[];

  isConfigured(conn: SupplierConnection): boolean;

  /** Search the catalogue. */
  searchProducts(conn: SupplierConnection, query: SearchQuery): Promise<SupplierProductPage>;

  /** Full product detail (variants, images, signals) for import. */
  getProduct(conn: SupplierConnection, externalProductId: string): Promise<SupplierProduct | null>;

  /** Live stock for the given products/variants. */
  syncInventory(conn: SupplierConnection, externalProductIds: string[]): Promise<InventoryLevel[]>;

  /** Live cost/MSRP for the given products/variants. */
  syncPricing(conn: SupplierConnection, externalProductIds: string[]): Promise<PriceQuote[]>;

  /** Shipping options to a destination. */
  getShipping(
    conn: SupplierConnection,
    externalProductId: string,
    to: ShippingDestination,
  ): Promise<ShippingOption[]>;

  /** Place a fulfilment order with the supplier. */
  createOrder(conn: SupplierConnection, order: SupplierOrderRequest): Promise<SupplierOrder>;

  /** Poll a placed order's status (sync orders / tracking). */
  getOrder(conn: SupplierConnection, externalOrderId: string): Promise<SupplierOrder | null>;
}
