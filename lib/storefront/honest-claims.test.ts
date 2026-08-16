import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

/*
 * Every surface a shopper sees, not just the homepage.
 *
 * This suite originally guarded one file, and the gap did exactly what a
 * single-file guard does: the homepage was cleaned of its fixed claim list
 * while the PRODUCT page — the screen where a promise actually converts a sale
 * — went on printing "Tracked delivery · Fast, insured shipping" and "30-day
 * returns · No questions asked" on every store Urivo had ever generated.
 *
 * The list is derived from the storefront directory rather than typed, so a new
 * shopper-facing surface is covered the day it is added.
 */
const STORE_DIR = fileURLToPath(new URL("../../app/(store)", import.meta.url));

function shopperFacingFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...shopperFacingFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

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
  "New collection",
  "Reviews",
  "Journal",
  "New in",
  "Best sellers",
  "Gift cards",
  "Sustainability",
  "Care guide",
  "Materials",
];

describe("no storefront surface authors a commercial claim", () => {
  const files = shopperFacingFiles(STORE_DIR);

  it("is actually looking at the storefront (a broken walk would pass everything)", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((f) => f.endsWith("storefront-renderer.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("product-view.tsx"))).toBe(true);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`ships no hardcoded ${label}`, () => {
      const offenders = files
        .map((f) => ({ f, hit: code(f).match(pattern) }))
        .filter((x) => x.hit)
        .map((x) => `${x.f.slice(STORE_DIR.length + 1)}: "${x.hit![0]}"`);
      expect(
        offenders,
        `these storefront files hardcode ${label}, which becomes the merchant's ` +
          `promise to their customer: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("links only to destinations that exist", () => {
    const found: string[] = [];
    for (const f of files) {
      const src = code(f);
      for (const label of INVENTED_NAV) {
        if (src.includes(`"${label}"`)) found.push(`${f.slice(STORE_DIR.length + 1)}: ${label}`);
      }
    }
    expect(found, `storefront links to pages no store has: ${found.join(", ")}`).toEqual([]);
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
