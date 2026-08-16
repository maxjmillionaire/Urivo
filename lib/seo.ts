/*
 * Storefront SEO: structured data (JSON-LD) so generated stores are legible to
 * search engines and AI answer engines, plus a deterministic content audit the
 * dashboard shows per store. No external data — this reasons only about the
 * store's own content, so it is always accurate.
 */

export interface SeoProduct {
  id?: string;
  title: string;
  description: string | null;
  price_eur: number | string;
  image_url?: string | null;
  /** null/undefined = not tracked, which the storefront treats as available. */
  inventory_count?: number | null;
}

export interface SeoStore {
  storeName: string;
  tagline: string;
  subdomain: string;
  url: string; // absolute storefront URL
  /** ISO-4217, from the store's own column. Not every store prices in EUR. */
  currency?: string | null;
  products: SeoProduct[];
}

/*
 * Availability and currency are FACTS, not defaults.
 *
 * Both were hardcoded here — every product declared `InStock` and `EUR`
 * regardless of its inventory or the store's currency. That was survivable while
 * structured data was only read by search engines, which treat it as a hint.
 * It stops being survivable now that shopping agents read these exact fields to
 * decide what to put in front of a buyer: an agent that is told "in stock" and
 * finds a sold-out product does not blame the agent, and a price in the wrong
 * currency is a wrong price, not a formatting detail.
 *
 * The mapping matches what the product page itself renders — `(count ?? 1) > 0`
 * — so the page and its structured data can never contradict each other.
 */
function availabilityOf(inventory: number | null | undefined): string {
  return (inventory ?? 1) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
}

function currencyOf(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "EUR";
}

function offerOf(p: SeoProduct, currency: string | null | undefined, url?: string) {
  return {
    "@type": "Offer",
    price: Number(p.price_eur).toFixed(2),
    priceCurrency: currencyOf(currency),
    availability: availabilityOf(p.inventory_count),
    ...(url ? { url } : {}),
  };
}

/**
 * Serialize a JSON-LD object for safe embedding inside an inline
 * <script type="application/ld+json"> tag. `JSON.stringify` alone does NOT
 * escape "<", so a product title or store name containing "</script>" would
 * break out of the script element and execute arbitrary markup (stored XSS on
 * the public storefront). Escaping "<" — plus the JS line separators U+2028 /
 * U+2029, which are valid in JSON but illegal in a script body — closes that
 * hole while keeping the output valid JSON-LD.
 */
export function jsonLdScript(data: Record<string, unknown>): string {
  const LINE_SEP = String.fromCharCode(0x2028);
  const PARA_SEP = String.fromCharCode(0x2029);
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

/** JSON-LD for the store (Organization + ItemList of products with Offers). */
export function storeJsonLd(store: SeoStore): Record<string, unknown> {
  const org = {
    "@type": "OnlineStore",
    name: store.storeName,
    url: store.url,
    ...(store.tagline ? { description: store.tagline } : {}),
  };
  const items = store.products.slice(0, 20).map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "Product",
      name: p.title,
      ...(p.description ? { description: p.description } : {}),
      ...(p.image_url ? { image: p.image_url } : {}),
      ...(p.id ? { url: `${store.url}/product/${p.id}` } : {}),
      offers: offerOf(p, store.currency, p.id ? `${store.url}/product/${p.id}` : undefined),
    },
  }));
  return {
    "@context": "https://schema.org",
    "@graph": [org, { "@type": "ItemList", itemListElement: items }],
  };
}

/**
 * The canonical public URL of a storefront.
 *
 * Structured data is the one place a relative URL is worthless — a crawler or a
 * shopping agent reads the JSON on its own and has no page to resolve it
 * against. This mirrors the storefront route's own helper so the canonical URL
 * has a single definition rather than one per surface that needs it.
 */
export function storefrontUrl(subdomain: string): string {
  const root = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  return root.startsWith("localhost")
    ? `http://localhost:3000/store/${subdomain}`
    : `https://${subdomain}.${root}`;
}

/**
 * JSON-LD for a single product page.
 *
 * The store page's ItemList tells a crawler that a product exists; this tells it
 * — and an AI shopping agent — everything needed to evaluate and transact:
 * stable identifier, canonical URL, price, currency, live availability, and the
 * brand it belongs to. That set is the entry ticket to agent-mediated discovery
 * (ACP, UCP), where a product with no structured offer is simply not a candidate.
 *
 * Deliberately absent: `aggregateRating` and `review`. A generated store has no
 * customers on day one, and inventing ratings would be the single most damaging
 * false claim the storefront could make — it is fraud, it is what search engines
 * issue manual actions for, and it is the reason the trust section renders
 * nothing the merchant did not author.
 */
export function productJsonLd(input: {
  product: SeoProduct;
  storeName: string;
  storeUrl: string;
  productUrl: string;
  currency?: string | null;
}): Record<string, unknown> {
  const { product: p, storeName, storeUrl, productUrl, currency } = input;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    ...(p.description ? { description: p.description } : {}),
    ...(p.image_url ? { image: p.image_url } : {}),
    ...(p.id ? { sku: p.id } : {}),
    brand: { "@type": "Brand", name: storeName },
    offers: {
      ...offerOf(p, currency, productUrl),
      seller: { "@type": "Organization", name: storeName, url: storeUrl },
    },
  };
}

/* ------------------------------- content audit ----------------------------- */

export type SeoSeverity = "pass" | "warn" | "fail";

export interface SeoCheck {
  key: string;
  label: string;
  status: SeoSeverity;
  detail: string;
}

export interface SeoAudit {
  score: number; // 0–100
  checks: SeoCheck[];
}

const TITLE_MIN = 3;
const TITLE_MAX = 60;
const META_MIN = 50;
const META_MAX = 160;
const DESC_MIN = 40;

/** Audit a store's content for on-page SEO. Deterministic and honest. */
export function auditStoreSeo(store: {
  storeName: string;
  tagline: string;
  products: SeoProduct[];
}): SeoAudit {
  const checks: SeoCheck[] = [];
  const name = store.storeName.trim();
  const meta = store.tagline.trim();
  const products = store.products;

  // Title / brand name
  checks.push(
    name.length >= TITLE_MIN && name.length <= TITLE_MAX
      ? { key: "title", label: "Page title", status: "pass", detail: `“${name}” is a clean, indexable title.` }
      : {
          key: "title",
          label: "Page title",
          status: name.length > TITLE_MAX ? "warn" : "fail",
          detail: name.length > TITLE_MAX ? "Title over 60 chars may be truncated in results." : "Give the store a name.",
        },
  );

  // Meta description (tagline)
  if (!meta) {
    checks.push({ key: "meta", label: "Meta description", status: "fail", detail: "No tagline — add a 50–160 char description search engines can show." });
  } else if (meta.length < META_MIN) {
    checks.push({ key: "meta", label: "Meta description", status: "warn", detail: `Only ${meta.length} chars — aim for 50–160 to fill the snippet.` });
  } else if (meta.length > META_MAX) {
    checks.push({ key: "meta", label: "Meta description", status: "warn", detail: `${meta.length} chars — over 160 will be truncated.` });
  } else {
    checks.push({ key: "meta", label: "Meta description", status: "pass", detail: `${meta.length} chars — well within the snippet window.` });
  }

  // Products present
  checks.push(
    products.length >= 3
      ? { key: "catalog", label: "Catalogue depth", status: "pass", detail: `${products.length} products give search engines real content to index.` }
      : { key: "catalog", label: "Catalogue depth", status: products.length === 0 ? "fail" : "warn", detail: "Aim for 3+ products for a crawlable catalogue." },
  );

  // Product descriptions
  const thin = products.filter((p) => (p.description ?? "").trim().length < DESC_MIN).length;
  checks.push(
    products.length === 0
      ? { key: "descriptions", label: "Product descriptions", status: "fail", detail: "No products to describe yet." }
      : thin === 0
        ? { key: "descriptions", label: "Product descriptions", status: "pass", detail: "Every product has a substantial description." }
        : { key: "descriptions", label: "Product descriptions", status: "warn", detail: `${thin} product${thin > 1 ? "s" : ""} under ${DESC_MIN} chars — thin copy ranks poorly.` },
  );

  // Imagery (alt/richness + social preview)
  const withImg = products.filter((p) => p.image_url).length;
  checks.push(
    products.length === 0
      ? { key: "images", label: "Product imagery", status: "warn", detail: "Add products, then generate imagery for richer results and social previews." }
      : withImg === products.length
        ? { key: "images", label: "Product imagery", status: "pass", detail: "All products have imagery — better for image search and link previews." }
        : { key: "images", label: "Product imagery", status: "warn", detail: `${products.length - withImg} product${products.length - withImg > 1 ? "s" : ""} without an image.` },
  );

  // Structured data — Urivo emits it automatically, so this always passes.
  checks.push({ key: "schema", label: "Structured data", status: "pass", detail: "Product + store schema (JSON-LD) is emitted automatically for rich results and AI answers." });

  const weight: Record<SeoSeverity, number> = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round((checks.reduce((s, c) => s + weight[c.status], 0) / checks.length) * 100);
  return { score, checks };
}
