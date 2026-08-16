import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  needsAiDisclosure,
  aiDisclosureFor,
  AI_DISCLOSURE,
  AI_DISCLOSURE_DE,
} from "./ai-disclosure";

/*
 * EU AI Act Art. 50 disclosure, from 2 August 2026.
 *
 * This rule has to be right in BOTH directions. Failing to disclose AI imagery
 * is a regulatory exposure for the merchant. Declaring a merchant's own
 * photographs to be AI is a false statement about their work — and in Germany,
 * where an inaccurate commercial claim is an Abmahnung waiting to happen, the
 * second mistake is not obviously cheaper than the first.
 */

const ai = { image_url: "https://cdn/x.png", image_source: "ai" };
const uploaded = { image_url: "https://cdn/x.png", image_source: "uploaded" };
const supplier = { image_url: "https://cdn/x.png", image_source: "supplier" };
const placeholder = { image_url: "https://cdn/x.png", image_source: "placeholder" };
const unknown = { image_url: "https://cdn/x.png", image_source: null };
const none = { image_url: null, image_source: null };

describe("when a store must disclose", () => {
  it("discloses when any product photo was generated", () => {
    expect(needsAiDisclosure([uploaded, ai, uploaded])).toBe(true);
  });

  it("discloses a branded placeholder — it is synthetic too", () => {
    expect(needsAiDisclosure([placeholder])).toBe(true);
  });

  it("discloses when provenance is unknown", () => {
    // Every image produced before provenance existed is unknown. An image we
    // cannot vouch for must not be quietly presented as a photograph.
    expect(needsAiDisclosure([unknown])).toBe(true);
  });
});

describe("when a store must NOT be made to disclose", () => {
  it("says nothing when the merchant uses their own photographs", () => {
    expect(needsAiDisclosure([uploaded, uploaded])).toBe(false);
  });

  it("says nothing for supplier photography", () => {
    expect(needsAiDisclosure([supplier, uploaded])).toBe(false);
  });

  it("stops disclosing once every AI photo has been replaced", () => {
    // The whole point of per-image provenance: a merchant who does the work of
    // shooting real product photography gets to stop labelling.
    expect(needsAiDisclosure([ai, uploaded])).toBe(true);
    expect(needsAiDisclosure([uploaded, uploaded])).toBe(false);
  });

  it("says nothing for a catalogue with no imagery at all", () => {
    expect(needsAiDisclosure([none, none])).toBe(false);
    expect(needsAiDisclosure([])).toBe(false);
  });

  it("ignores provenance on a product that has no image", () => {
    expect(needsAiDisclosure([{ image_url: null, image_source: "ai" }])).toBe(false);
  });
});

describe("the wording", () => {
  it("is descriptive, never a warning or an apology", () => {
    for (const copy of [AI_DISCLOSURE, AI_DISCLOSURE_DE]) {
      const lower = copy.toLowerCase();
      // A hazard notice on a product shot reads as a defect and costs the sale.
      expect(lower).not.toMatch(/warn|caution|achtung|disclaimer|haftung|not real|nicht echt|fake/);
      expect(copy.length).toBeLessThan(60);
    }
  });

  it("actually names AI, so it is a disclosure rather than a hint", () => {
    expect(AI_DISCLOSURE).toMatch(/\bAI\b/);
    expect(AI_DISCLOSURE_DE).toMatch(/\bKI\b/);
  });

  it("discloses in the language the store itself is written in", () => {
    expect(aiDisclosureFor("Werkzeug, das die Menschen überlebt, die es gekauft haben.")).toBe(AI_DISCLOSURE_DE);
    expect(aiDisclosureFor("Tools that outlive the person who bought them.")).toBe(AI_DISCLOSURE);
  });

  it("falls back to English rather than guessing from nothing", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(aiDisclosureFor(v)).toBe(AI_DISCLOSURE);
    }
  });
});

/*
 * The rule above was correct from the day it was written, and the product page
 * still shipped without it for months — because being correct and being APPLIED
 * are different properties, and only the first one had a test.
 *
 * This is the second time this exact shape of gap has appeared in the
 * storefront: honest-claims.test.ts exists because the homepage was cleaned of
 * its invented commercial claims while the product page went on printing them.
 * The lesson generalises, so this guard is structural rather than a list: walk
 * every shopper-facing file, and require that any surface rendering product
 * imagery also applies the disclosure rule. A new surface is covered the day it
 * is added, without anyone remembering to come back here.
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

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("every shopper-facing surface that shows imagery applies the rule", () => {
  const files = shopperFacingFiles(STORE_DIR);

  it("is actually looking at the storefront (a broken walk would pass everything)", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((f) => f.endsWith("storefront-renderer.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("product-view.tsx"))).toBe(true);
  });

  it("renders no product image without disclosing its provenance", () => {
    /*
     * "Renders imagery" is read as: the file contains an <img> whose src is a
     * product image. Cart and checkout surfaces show a thumbnail of something
     * the shopper already chose from a disclosed surface, so they are exempt —
     * the disclosure belongs where the buying decision is made.
     */
    const EXEMPT = /store-cart|checkout/i;
    const offenders = files
      .filter((f) => !EXEMPT.test(f))
      .filter((f) => {
        const src = code(f);
        const showsProductImage = /<img[^>]*src=\{[^}]*\bimage_url\b/.test(src);
        const applies = src.includes("needsAiDisclosure");
        return showsProductImage && !applies;
      })
      .map((f) => f.slice(STORE_DIR.length + 1));

    expect(
      offenders,
      "these storefront surfaces show product photography without applying the " +
        "AI Act Art. 50 disclosure rule — the merchant publishes synthetic " +
        `imagery with no label on the screen the shopper buys from: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("reads provenance out of the database wherever it renders it", () => {
    /*
     * The rule treats missing provenance as "unknown" and discloses. That is the
     * safe direction for the merchant's exposure but the WRONG one for their
     * credibility: a query that forgets `image_source` makes every store label
     * its photographs as AI, including the merchant who shot their own. So any
     * route feeding a disclosed surface must select the column.
     */
    const routes = files.filter((f) => /\/page\.tsx$/.test(f) && code(f).includes("image_url"));
    const missing = routes
      .filter((f) => !code(f).includes("image_source"))
      .map((f) => f.slice(STORE_DIR.length + 1));

    expect(
      missing,
      `these routes select image_url without image_source, which makes the ` +
        `disclosure fire on real photography: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
