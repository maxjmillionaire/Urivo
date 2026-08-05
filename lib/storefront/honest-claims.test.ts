import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDesignSystem } from "./design-system";

/*
 * The renderer may not make promises on a merchant's behalf.
 *
 * Every generated store used to publish a fixed set of commercial terms —
 * "Free shipping · On all orders over €60", "30-day returns · No questions
 * asked", "Carbon-aware delivery · Offset on every order" — that no merchant
 * had agreed to. A German chisel maker was promising carbon-offset shipping.
 * In the EU, shipping terms, returns windows and environmental claims are all
 * regulated, and the merchant, not Urivo, is the one bound by them.
 *
 * These tests hold that line from two directions: the renderer source must
 * contain no such claim, and the design system must render nothing where the
 * brand authored nothing.
 */

const RENDERER = fileURLToPath(
  new URL("../../app/(store)/store/[subdomain]/storefront-renderer.tsx", import.meta.url),
);

/** Comments are allowed to *describe* the retired claims — code may not ship them. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Claims a merchant must make for themselves, phrased as the renderer once did. */
const FORBIDDEN: [string, RegExp][] = [
  ["a shipping promise", /free shipping|ships? free|free delivery/i],
  ["a returns window", /\d+[- ]day returns?|no questions asked|free returns?/i],
  ["a delivery-time promise", /next[- ]day|delivered in \d|\d+[- ]day delivery/i],
  ["an environmental claim", /carbon[- ]?(aware|neutral|negative|offset)|climate[- ]positive|offset on every/i],
  ["a manufacturing claim", /small runs?|small[- ]batch|hand[- ]?(made|crafted)|ethically sourced/i],
  ["a guarantee", /money[- ]back|satisfaction guarantee|lifetime warranty/i],
];

/*
 * Navigation the store cannot honour. Every one of these shipped as a link to
 * the product grid: a Journal with no posts, Reviews on a shop with no
 * customers, Best sellers with no sales, a Sustainability page that is a
 * regulated claim rendered as furniture.
 */
const INVENTED_NAV = [
  "Reviews",
  "Journal",
  "New in",
  "Best sellers",
  "Gift cards",
  "Sustainability",
  "Care guide",
  "Materials",
];

describe("the storefront renderer authors no commercial claims", () => {
  const source = code(RENDERER);

  for (const [label, pattern] of FORBIDDEN) {
    it(`ships no hardcoded ${label}`, () => {
      const hit = source.match(pattern);
      expect(
        hit,
        hit ? `renderer hardcodes ${label}: "${hit[0]}" — this becomes the merchant's promise` : "",
      ).toBeNull();
    });
  }

  it("links only to destinations that exist", () => {
    const found = INVENTED_NAV.filter((label) => source.includes(`"${label}"`));
    expect(found, `renderer links to pages no store has: ${found.join(", ")}`).toEqual([]);
  });
});

describe("proof points are rendered only when the brand authored them", () => {
  const base = {
    personality: "Precise, industrial",
    palette: { background: "#111111", ink: "#F2F2F2", accent: "#C08A3E" },
    fonts: { headingKey: "archivo", bodyKey: "inter" },
  };

  it("leaves trust and highlights unset when nothing was authored", () => {
    const ds = parseDesignSystem(base);
    expect(ds.trust).toBeUndefined();
    expect(ds.highlights).toBeUndefined();
    expect(ds.layout.sectionOrder).not.toContain("trust");
    expect(ds.layout.sectionOrder).not.toContain("highlights");
  });

  it("keeps a section out of the order even when the model asked for it empty", () => {
    // The section key alone must not resurrect boilerplate: with no items the
    // section renders nothing, so the page simply has one fewer beat.
    const ds = parseDesignSystem({
      ...base,
      layout: { sectionOrder: ["hero", "trust", "collection", "highlights"] },
    });
    expect(ds.trust).toBeUndefined();
    expect(ds.highlights).toBeUndefined();
  });

  it("accepts authored proof points and places them around the catalogue", () => {
    const ds = parseDesignSystem({
      ...base,
      story: "We make one chisel and we make it properly.",
      trust: [
        { title: "Fourteen days to return", detail: "Unused, in its box, no argument." },
        { title: "Secure checkout", detail: "Card details encrypted in transit." },
        { title: "Sharpening advice", detail: "Write to us and a maker replies." },
      ],
      highlights: [
        { title: "O1 tool steel", detail: "Hardened to 61 HRC and ground flat." },
        { title: "One bevel angle", detail: "25 degrees, the angle joiners actually use." },
        { title: "Sold singly", detail: "Buy the size you need, not a set of eight." },
      ],
    });
    expect(ds.trust).toHaveLength(3);
    expect(ds.highlights).toHaveLength(3);

    const order = ds.layout.sectionOrder;
    const at = (k: string) => order.indexOf(k as never);
    expect(at("story")).toBeGreaterThan(-1);
    expect(at("highlights")).toBeLessThan(at("collection"));
    expect(at("trust")).toBeGreaterThan(at("collection"));
    expect(order[order.length - 1]).toBe("footer");
  });

  it("drops half-written proof points rather than padding them", () => {
    const ds = parseDesignSystem({
      ...base,
      trust: [
        { title: "Secure checkout", detail: "Encrypted in transit." },
        { title: "No detail given" },
        { detail: "No title given" },
        { title: "  ", detail: "  " },
      ],
    });
    expect(ds.trust).toHaveLength(1);
  });

  it("clamps an over-long or oversized payload", () => {
    const ds = parseDesignSystem({
      ...base,
      highlights: Array.from({ length: 12 }, (_, i) => ({
        title: `Point ${i} ${"x".repeat(200)}`,
        detail: "y".repeat(500),
      })),
    });
    expect(ds.highlights).toHaveLength(3);
    expect(ds.highlights![0].title.length).toBeLessThanOrEqual(48);
    expect(ds.highlights![0].detail.length).toBeLessThanOrEqual(160);
  });

  it("ignores a hostile payload shape without throwing", () => {
    const ds = parseDesignSystem({ ...base, trust: "free shipping", highlights: 42 });
    expect(ds.trust).toBeUndefined();
    expect(ds.highlights).toBeUndefined();
  });
});
