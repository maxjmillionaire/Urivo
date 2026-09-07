import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE_MODULES,
  KNOWLEDGE_MODULE_MAX_CHARS,
  selectKnowledge,
  renderKnowledge,
} from "./knowledge";

/*
 * The deep-knowledge library only earns its place if the selector reaches the
 * RIGHT module for a real question, never carries the whole shelf, and each card
 * stays small enough to ride a turn cheaply. And like the doctrine, it must read
 * as Urivo's own voice — expert, hype-free, no course branding.
 */

describe("knowledge library — shape and hygiene", () => {
  it("has unique ids and non-empty tags on every module", () => {
    const ids = KNOWLEDGE_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of KNOWLEDGE_MODULES) {
      expect(m.tags.length).toBeGreaterThan(0);
      expect(m.content.trim().length).toBeGreaterThan(0);
      expect(m.tags.every((t) => t === t.toLowerCase())).toBe(true);
    }
  });

  it("keeps every module a card, not a chapter (cost guard)", () => {
    for (const m of KNOWLEDGE_MODULES) {
      expect(m.content.length, `${m.id} is too long`).toBeLessThanOrEqual(KNOWLEDGE_MODULE_MAX_CHARS);
    }
  });

  it("holds the hype-free voice and lifts no course branding", () => {
    const banned = ["Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash"];
    for (const m of KNOWLEDGE_MODULES) {
      const text = m.content.toLowerCase();
      for (const word of banned) expect(text, `${m.id}`).not.toContain(word.toLowerCase());
      expect(m.content, `${m.id}`).not.toContain("!");
      expect(m.content).not.toContain("OTS");
    }
  });
});

describe("selectKnowledge — reaches the right module", () => {
  const pick = (q: string) => selectKnowledge(q).map((m) => m.id);

  it("routes questions to the module that answers them", () => {
    expect(pick("my ROAS looks great in Meta but my bank says otherwise")).toContain("measurement");
    expect(pick("how should I structure my email flows in klaviyo?")).toContain("email-flows");
    expect(pick("what's the fastest way to raise my average order value?")).toContain("aov-upsell");
    expect(pick("should I run TikTok or Google ads for this product?")).toContain("paid-channels");
    expect(pick("how do I scale a winning ad without breaking it?")).toContain("scaling-structure");
    expect(pick("how do I find a good sourcing agent and vet the supplier?")).toContain("sourcing-margin");
  });

  it("returns nothing for a question no module covers (doctrine alone answers)", () => {
    expect(selectKnowledge("hi there")).toEqual([]);
    expect(selectKnowledge("what should my brand name be?")).toEqual([]);
  });

  it("never carries more than the cap", () => {
    // A question that brushes several topics still injects at most two modules.
    const many = selectKnowledge(
      "how do I test creative, scale the budget, fix attribution and raise AOV?",
    );
    expect(many.length).toBeLessThanOrEqual(2);
  });

  it("ranks the most-relevant module first", () => {
    // Several retention/subscription terms should out-score a single stray tag.
    const [first] = selectKnowledge("how do I raise lifetime value with a subscription and win-back?");
    expect(first.id).toBe("retention-ltv");
  });
});

describe("renderKnowledge", () => {
  it("returns empty string when nothing was selected", () => {
    expect(renderKnowledge([])).toBe("");
  });

  it("labels the block and includes each selected card's title and content", () => {
    const rendered = renderKnowledge(selectKnowledge("help me plan my abandoned checkout email flow"));
    expect(rendered).toContain("RELEVANT PLAYBOOK");
    expect(rendered).toContain("Email & SMS flow architecture");
    expect(rendered.toLowerCase()).toContain("abandoned checkout");
  });
});
