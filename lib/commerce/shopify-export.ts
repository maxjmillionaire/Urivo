/*
 * Shopify product export (V1) — a portability / trust feature.
 *
 * Urivo → normalised DTO → classic Shopify product-import CSV. Deliberately not
 * a store migration: no theme, no checkout, no navigation. Just the product
 * data the merchant created, in the format Shopify's CSV importer accepts.
 *
 * HONESTY ABOUT THE FORMAT
 * Shopify's current help pages present newer "friendly" headers (URL handle,
 * Description, Product image URL…), but the long-standing CSV importer — and the
 * sample file it hands you — uses the classic headers below (Handle, Title,
 * Body (HTML), Variant Price, Image Src…). The classic set stays import-
 * compatible and is the widely-supported target, so that is what we emit. We do
 * NOT promise "import never fails": unknown columns are ignored on import and
 * missing optional columns default, but the merchant should still validate
 * against their store's current template.
 *
 * WHAT URIVO ACTUALLY HAS (inspected, not assumed): one image per product, a
 * single price, an inventory count, a title and a description. No variants, no
 * SKUs, no collections, no multiple images. So each product exports as ONE row
 * with Shopify's single-variant convention (Option1 Name "Title" / Value
 * "Default Title") and at most one image. Nothing is invented.
 *
 * This module is pure: no I/O, no server-only imports, so every escaping and
 * mapping rule is unit-testable.
 */

export interface ExportableProduct {
  title: string;
  description: string | null;
  priceEUR: number;
  imageUrl: string | null;
  inventoryCount: number;
}

/** Classic Shopify product-import columns, in order. The row builder is driven
 *  from this list so a header can never drift from the value under it. */
export const SHOPIFY_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Status",
] as const;

/**
 * A URL handle from a title: ASCII-folded, lowercased, non-alphanumerics to a
 * single hyphen, trimmed. Diacritics are stripped so "Café Noir" → "cafe-noir"
 * rather than a handle Shopify would reject. Empty titles fall back to "product".
 */
export function slugifyHandle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
  return base || "product";
}

/**
 * Deterministic handle dedup: a repeated slug becomes handle, handle-2,
 * handle-3… in input (position) order. Shopify treats rows sharing a Handle as
 * one product's variants/images, so single-variant products MUST have unique
 * handles or they'd be silently merged.
 */
function uniqueHandles(products: ExportableProduct[]): string[] {
  const seen = new Map<string, number>();
  return products.map((p) => {
    const base = slugifyHandle(p.title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  });
}

/** Price as a plain decimal string in the store's currency (no symbol). */
function price(eur: number): string {
  return Number.isFinite(eur) && eur > 0 ? eur.toFixed(2) : "0.00";
}

/** Build the ordered cell values for one product row, aligned to SHOPIFY_COLUMNS. */
function row(storeName: string, handle: string, p: ExportableProduct): string[] {
  const hasImage = typeof p.imageUrl === "string" && p.imageUrl.trim().length > 0;
  const qty = Number.isFinite(p.inventoryCount) ? Math.max(0, Math.trunc(p.inventoryCount)) : 0;
  const values: Record<(typeof SHOPIFY_COLUMNS)[number], string> = {
    Handle: handle,
    Title: p.title,
    "Body (HTML)": p.description ?? "",
    Vendor: storeName,
    Tags: "",
    Published: "TRUE",
    "Option1 Name": "Title",
    "Option1 Value": "Default Title",
    "Variant SKU": "",
    "Variant Inventory Tracker": "shopify",
    "Variant Inventory Qty": String(qty),
    "Variant Inventory Policy": "deny",
    "Variant Fulfillment Service": "manual",
    "Variant Price": price(p.priceEUR),
    "Variant Requires Shipping": "true",
    "Variant Taxable": "true",
    "Image Src": hasImage ? p.imageUrl!.trim() : "",
    "Image Position": hasImage ? "1" : "",
    "Image Alt Text": hasImage ? p.title : "",
    Status: "active",
  };
  return SHOPIFY_COLUMNS.map((c) => values[c]);
}

/** Quote every cell (RFC 4180: doubled inner quotes) — a comma, quote or
 *  newline in a title or description then cannot break out of its column. */
function csvLine(cells: string[]): string {
  return cells.map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
}

/**
 * The full Shopify product CSV for a store.
 *
 * No BOM: this file is consumed by Shopify's importer (a leading BOM can make it
 * misread the first header), not opened in Excel. CRLF line endings, UTF-8 (set
 * by the response charset), all fields quoted.
 */
export function shopifyProductCsv(storeName: string, products: ExportableProduct[]): string {
  const handles = uniqueHandles(products);
  const lines = [
    csvLine([...SHOPIFY_COLUMNS]),
    ...products.map((p, i) => csvLine(row(storeName, handles[i], p))),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Download filename for a store's export. */
export function shopifyExportFilename(subdomain: string): string {
  const safe = slugifyHandle(subdomain) || "store";
  return `${safe}-shopify-products.csv`;
}
