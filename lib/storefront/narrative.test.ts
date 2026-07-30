import { describe, it, expect } from "vitest";
import { parseNarrative, type HeroBlock } from "./narrative";

const hero = { kind: "hero", intent: "hook", emphasis: "bold", headline: "Sleep like the tide" };

describe("parseNarrative — untrusted model output is clamped, never trusted", () => {
  it("rejects non-arrays and empty input", () => {
    expect(parseNarrative(null, 5)).toBeNull();
    expect(parseNarrative({}, 5)).toBeNull();
    expect(parseNarrative([], 5)).toBeNull();
  });

  it("returns null when there is no usable hero (fall back rather than fabricate)", () => {
    expect(parseNarrative([{ kind: "quote", intent: "x", emphasis: "calm", text: "hi" }], 5)).toBeNull();
  });

  it("guarantees the shop (collection) even if the model omitted it", () => {
    const out = parseNarrative([hero], 5);
    expect(out).not.toBeNull();
    expect(out!.some((b) => b.kind === "hero")).toBe(true);
    expect(out!.some((b) => b.kind === "collection")).toBe(true);
  });

  it("dedupes singular beats — only one hero survives", () => {
    const out = parseNarrative([hero, { ...hero, headline: "A second hook" }], 5)!;
    expect(out.filter((b) => b.kind === "hero")).toHaveLength(1);
  });

  it("drops malformed beats (a marquee needs at least two phrases)", () => {
    const out = parseNarrative([hero, { kind: "marquee", intent: "x", emphasis: "calm", phrases: ["only one"] }], 5)!;
    expect(out.some((b) => b.kind === "marquee")).toBe(false);
  });

  it("clamps an out-of-range hero product index to the real catalogue", () => {
    const out = parseNarrative([{ ...hero, heroProductIndex: 99 }], 3)!;
    const h = out.find((b) => b.kind === "hero") as HeroBlock;
    expect(h.heroProductIndex).toBeNull(); // 99 >= 3 → dropped to null
  });

  it("caps the narrative length even under a flood of beats", () => {
    const flood = [
      hero,
      { kind: "collection", intent: "shop", emphasis: "calm" },
      ...Array.from({ length: 20 }, (_, i) => ({ kind: "quote", intent: "x", emphasis: "calm", text: `q${i}` })),
    ];
    const out = parseNarrative(flood, 5)!;
    expect(out.length).toBeLessThanOrEqual(11);
  });
});
