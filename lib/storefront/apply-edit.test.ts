import { describe, it, expect } from "vitest";
import { resolveProductEdits, applyDesignPatch } from "./apply-edit";
import { parseDesignSystem } from "./design-system";

const rows = [
  { id: "a", title: "A", description: "da", price_eur: 10, position: 0 },
  { id: "b", title: "B", description: "db", price_eur: 20, position: 1 },
];

describe("resolveProductEdits — a stale plan must never corrupt the catalogue", () => {
  it("ignores out-of-range update/remove indices", () => {
    const mut = resolveProductEdits(rows, [
      { action: "update", index: 99, title: "X" },
      { action: "remove", index: -1 },
    ]);
    expect(mut.updates).toHaveLength(0);
    expect(mut.deletes).toHaveLength(0);
  });

  it("maps 0-based indices to the correct row ids", () => {
    const mut = resolveProductEdits(rows, [
      { action: "update", index: 1, priceEUR: 25 },
      { action: "remove", index: 0 },
    ]);
    expect(mut.updates[0]).toMatchObject({ id: "b", price_eur: 25 });
    expect(mut.deletes).toEqual(["a"]);
  });

  it("appends inserts after the current max position", () => {
    const mut = resolveProductEdits(rows, [
      { action: "add", title: "C", description: "dc", priceEUR: 5 },
    ]);
    expect(mut.inserts[0]).toMatchObject({ title: "C", position: 2 });
  });
});

describe("applyDesignPatch — a small edit must not wipe the authored intelligence", () => {
  const current = parseDesignSystem(
    {
      personality: "calm, editorial",
      tagline: "Quiet luxury",
      story: "Founded on a shoreline.",
      narrative: [{ kind: "hero", intent: "hook", emphasis: "bold", headline: "An idea, not a wordmark" }],
      palette: { background: "#0b0b0b", ink: "#f2f2f2", accent: "#c0a062" },
      fonts: {},
      typeStyle: {},
      shape: {},
      space: {},
      layout: {},
    },
    3,
  );

  it("carries the narrative and story through a palette-only tweak (regression: Ask-Urivo edit)", () => {
    const next = applyDesignPatch(current, { accent: "#ff3366" });
    expect(next.narrative?.some((b) => b.kind === "hero")).toBe(true);
    expect(next.story).toBe("Founded on a shoreline.");
  });
});
