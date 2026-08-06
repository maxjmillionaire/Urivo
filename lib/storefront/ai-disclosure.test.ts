import { describe, it, expect } from "vitest";
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
