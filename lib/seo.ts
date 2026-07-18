/*
 * Storefront SEO: structured data (JSON-LD) so generated stores are legible to
 * search engines and AI answer engines, plus a deterministic content audit the
 * dashboard shows per store. No external data — this reasons only about the
 * store's own content, so it is always accurate.
 */

export interface SeoProduct {
  title: string;
  description: string | null;
  price_eur: number | string;
  image_url?: string | null;
}

export interface SeoStore {
  storeName: string;
  tagline: string;
  subdomain: string;
  url: string; // absolute storefront URL
  products: SeoProduct[];
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
      offers: {
        "@type": "Offer",
        price: Number(p.price_eur).toFixed(2),
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
      },
    },
  }));
  return {
    "@context": "https://schema.org",
    "@graph": [org, { "@type": "ItemList", itemListElement: items }],
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
