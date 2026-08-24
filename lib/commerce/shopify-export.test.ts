import { describe, it, expect } from "vitest";
import {
  slugifyHandle,
  shopifyProductCsv,
  shopifyExportFilename,
  SHOPIFY_COLUMNS,
  type ExportableProduct,
} from "./shopify-export";

/*
 * The export is a trust feature — a merchant hands this CSV to Shopify — so the
 * rules that make it *valid* are pinned: exact classic headers, correct RFC-4180
 * quoting so hostile titles can't break a column, ASCII-safe deduped handles,
 * UTF-8 preserved, and empty values handled rather than emitted as broken cells.
 */

const P = (over: Partial<ExportableProduct> = {}): ExportableProduct => ({
  title: "Candle",
  description: "A candle.",
  priceEUR: 24,
  imageUrl: "https://cdn.example.com/a.png",
  inventoryCount: 100,
  ...over,
});

const rowsOf = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n");

describe("slugifyHandle", () => {
  it("folds diacritics and lowercases to an ASCII handle", () => {
    expect(slugifyHandle("Café Noir")).toBe("cafe-noir");
  });
  it("collapses punctuation and whitespace to single hyphens, trimmed", () => {
    expect(slugifyHandle("  Hello, World!!  ")).toBe("hello-world");
  });
  it("falls back to 'product' for an empty/symbol-only title", () => {
    expect(slugifyHandle("")).toBe("product");
    expect(slugifyHandle("—")).toBe("product");
  });
});

describe("shopifyProductCsv — structure", () => {
  it("emits the exact classic header row, quoted, no BOM", () => {
    const csv = shopifyProductCsv("Nordljus", [P()]);
    expect(csv.charCodeAt(0)).toBe('"'.charCodeAt(0)); // NOT 0xFEFF
    const header = rowsOf(csv)[0];
    expect(header).toBe(SHOPIFY_COLUMNS.map((c) => `"${c}"`).join(","));
    // spot-check the columns Shopify actually keys on
    expect(header).toContain('"Handle"');
    expect(header).toContain('"Body (HTML)"');
    expect(header).toContain('"Variant Price"');
    expect(header).toContain('"Image Src"');
    expect(header).toContain('"Status"');
  });

  it("writes one row per product plus the header, CRLF-terminated", () => {
    const csv = shopifyProductCsv("Nordljus", [P(), P({ title: "Bowl" })]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(rowsOf(csv)).toHaveLength(3);
  });
});

describe("shopifyProductCsv — deterministic handles", () => {
  it("dedupes colliding handles in position order", () => {
    const csv = shopifyProductCsv("S", [P({ title: "Candle" }), P({ title: "candle!" }), P({ title: "CANDLE" })]);
    const [, r1, r2, r3] = rowsOf(csv);
    expect(r1.startsWith('"candle",')).toBe(true);
    expect(r2.startsWith('"candle-2",')).toBe(true);
    expect(r3.startsWith('"candle-3",')).toBe(true);
  });
});

describe("shopifyProductCsv — escaping & encoding", () => {
  it("keeps a comma/quote/newline title inside one quoted cell (RFC 4180)", () => {
    const csv = shopifyProductCsv("S", [P({ title: 'Big, "Bold" Candle', description: "line1\nline2" })]);
    expect(csv).toContain('"Big, ""Bold"" Candle"');
    expect(csv).toContain('"line1\nline2"');
  });

  it("preserves UTF-8 in the visible fields while the handle stays ASCII", () => {
    const csv = shopifyProductCsv("Åre Co", [P({ title: "Bougie Café" })]);
    expect(csv).toContain('"Bougie Café"'); // Title keeps accents
    expect(csv).toContain('"Åre Co"'); // Vendor keeps accents
    expect(csv).toContain('"bougie-cafe",'); // Handle is folded
  });
});

describe("shopifyProductCsv — values", () => {
  it("formats price as a plain 2dp decimal and carries inventory", () => {
    const csv = shopifyProductCsv("S", [P({ priceEUR: 12, inventoryCount: 7 })]);
    expect(csv).toContain('"12.00"');
    expect(csv).toContain('"7"');
  });

  it("handles a missing image without emitting a broken cell", () => {
    const csv = shopifyProductCsv("S", [P({ imageUrl: null })]);
    const row = rowsOf(csv)[1].split('","');
    const imgSrcIdx = SHOPIFY_COLUMNS.indexOf("Image Src");
    // Image Src / Position / Alt all empty, but the row still has every column.
    expect(rowsOf(csv)[1].match(/","/g)?.length).toBe(SHOPIFY_COLUMNS.length - 1);
    expect(row[imgSrcIdx].replace(/"/g, "")).toBe("");
  });

  it("marks each row as a published, active, single-variant product", () => {
    const csv = shopifyProductCsv("S", [P()]);
    const line = rowsOf(csv)[1];
    expect(line).toContain('"Default Title"');
    expect(line).toContain('"TRUE"');
    expect(line).toContain('"active"');
  });
});

describe("shopifyExportFilename", () => {
  it("derives a safe filename from the subdomain", () => {
    expect(shopifyExportFilename("nordljus")).toBe("nordljus-shopify-products.csv");
  });
});
