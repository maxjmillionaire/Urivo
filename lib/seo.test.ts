import { describe, it, expect } from "vitest";
import { jsonLdScript, storeJsonLd, productJsonLd, storefrontUrl } from "./seo";

/*
 * Structured data is read by machines that cannot see the page, and — since
 * 2026 — increasingly by shopping agents that decide what a buyer is shown.
 * Two properties matter and neither is cosmetic: it must not be a way to inject
 * script into a public storefront, and it must not state things that are false.
 */

const product = {
  id: "0b7f0a2e-1111-4222-8333-444455556666",
  title: "Bench chisel, 12mm",
  description: "Forged from a single billet.",
  price_eur: 48,
  image_url: "https://cdn.example/chisel.png",
  inventory_count: 3,
};

describe("script embedding is not an injection hole", () => {
  it("escapes < so a title cannot close the script element", () => {
    const out = jsonLdScript({ name: "</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });

  it("escapes the JS line separators, which are legal JSON but illegal in a script body", () => {
    const out = jsonLdScript({ name: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(String.fromCharCode(0x2028));
  });

  it("still produces valid JSON", () => {
    const out = jsonLdScript(productJsonLd({
      product: { ...product, title: "</script> & <b>" },
      storeName: "Hallmark Tools",
      storeUrl: "https://hallmark.urivo.ai",
      productUrl: "https://hallmark.urivo.ai/product/1",
    }));
    expect(() => JSON.parse(out.replace(/\\u003c/g, "<"))).not.toThrow();
  });
});

describe("availability is the truth, not a default", () => {
  const offerOf = (inventory: number | null | undefined) =>
    (productJsonLd({
      product: { ...product, inventory_count: inventory },
      storeName: "S",
      storeUrl: "https://s.urivo.ai",
      productUrl: "https://s.urivo.ai/product/1",
    }).offers as Record<string, unknown>);

  it("reports a sold-out product as out of stock", () => {
    // The old code hardcoded InStock. An agent told a sold-out product is
    // available puts it in front of a buyer, and the merchant eats the failure.
    expect(offerOf(0).availability).toBe("https://schema.org/OutOfStock");
  });

  it("reports a stocked product as in stock", () => {
    expect(offerOf(5).availability).toBe("https://schema.org/InStock");
  });

  it("treats untracked inventory as available, exactly as the page does", () => {
    // product-view renders `(inventory_count ?? 1) > 0`. If these two disagree,
    // the page and its structured data contradict each other on the same screen.
    expect(offerOf(null).availability).toBe("https://schema.org/InStock");
    expect(offerOf(undefined).availability).toBe("https://schema.org/InStock");
  });
});

describe("currency comes from the store", () => {
  const priceCurrency = (currency: string | null | undefined) =>
    (productJsonLd({
      product,
      storeName: "S",
      storeUrl: "https://s.urivo.ai",
      productUrl: "https://s.urivo.ai/product/1",
      currency,
    }).offers as Record<string, unknown>).priceCurrency;

  it("uses the store's own currency, upper-cased", () => {
    expect(priceCurrency("gbp")).toBe("GBP");
    expect(priceCurrency("CHF")).toBe("CHF");
  });

  it("falls back to EUR rather than emitting a malformed code", () => {
    for (const bad of [null, undefined, "", "euros", "€"]) {
      expect(priceCurrency(bad)).toBe("EUR");
    }
  });

  it("carries the store currency through the store-level ItemList too", () => {
    const ld = storeJsonLd({
      storeName: "S",
      tagline: "t",
      subdomain: "s",
      url: "https://s.urivo.ai",
      currency: "sek",
      products: [product],
    });
    const graph = ld["@graph"] as Record<string, unknown>[];
    const list = graph[1].itemListElement as Record<string, unknown>[];
    const offer = (list[0].item as Record<string, unknown>).offers as Record<string, unknown>;
    expect(offer.priceCurrency).toBe("SEK");
  });
});

describe("the product node is complete enough for an agent to act on", () => {
  const ld = productJsonLd({
    product,
    storeName: "Hallmark Tools",
    storeUrl: "https://hallmark.urivo.ai",
    productUrl: "https://hallmark.urivo.ai/product/0b7f0a2e-1111-4222-8333-444455556666",
    currency: "eur",
  });
  const offers = ld.offers as Record<string, unknown>;

  it("carries a stable identifier and a canonical URL", () => {
    expect(ld.sku).toBe(product.id);
    expect(offers.url).toContain("/product/0b7f0a2e");
  });

  it("names the seller and the brand", () => {
    expect((ld.brand as Record<string, unknown>).name).toBe("Hallmark Tools");
    expect((offers.seller as Record<string, unknown>).name).toBe("Hallmark Tools");
  });

  it("formats price as a decimal string, which schema.org expects", () => {
    expect(offers.price).toBe("48.00");
  });

  it("invents no ratings or reviews", () => {
    // A generated store has no customers. Fabricated ratings are the most
    // damaging false claim a storefront can make and draw manual actions.
    expect(ld.aggregateRating).toBeUndefined();
    expect(ld.review).toBeUndefined();
    expect(JSON.stringify(ld)).not.toMatch(/rating|review/i);
  });

  it("omits optional fields rather than emitting empty ones", () => {
    const bare = productJsonLd({
      product: { title: "X", description: null, price_eur: 1 },
      storeName: "S",
      storeUrl: "https://s.urivo.ai",
      productUrl: "https://s.urivo.ai/product/1",
    });
    expect(bare.description).toBeUndefined();
    expect(bare.image).toBeUndefined();
    expect(bare.sku).toBeUndefined();
  });
});

describe("canonical storefront URL", () => {
  it("is absolute — a relative URL is worthless in structured data", () => {
    expect(storefrontUrl("hallmark")).toMatch(/^https?:\/\//);
  });
});
