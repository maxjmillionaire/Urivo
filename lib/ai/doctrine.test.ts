import { describe, it, expect } from "vitest";
import { OPERATOR_DOCTRINE, OPERATOR_DOCTRINE_MAX_CHARS } from "./doctrine";

/*
 * The doctrine rides on every Ask Urivo turn as a cached system block, so it has
 * to earn its place: it must actually carry the operator numbers that turn a
 * generic reply into a diagnosis, stay bounded so it can't creep into the cost
 * model, and read as Urivo's own voice rather than lifted course branding.
 */

describe("operator doctrine — the knowledge Ask Urivo reasons with", () => {
  it("stays under the hard character ceiling (protects the per-turn cost model)", () => {
    // If this fails, the doctrine has grown into a library. Depth belongs in a
    // retrieval layer, not in the block that ships on every message.
    expect(OPERATOR_DOCTRINE.length).toBeLessThanOrEqual(OPERATOR_DOCTRINE_MAX_CHARS);
  });

  it("carries the four levers — the frame every diagnosis hangs on", () => {
    for (const lever of ["traffic", "conversion", "average order value", "repeat rate"]) {
      expect(OPERATOR_DOCTRINE.toLowerCase()).toContain(lever);
    }
  });

  it("carries the hard operator numbers, not just vibes", () => {
    // These specific figures are what make the advice expert rather than basic.
    expect(OPERATOR_DOCTRINE).toContain("3x"); // 3x landed cost
    expect(OPERATOR_DOCTRINE).toContain("landed cost");
    expect(OPERATOR_DOCTRINE).toContain("gross margin"); // break-even ROAS = 1 / gross margin
    expect(OPERATOR_DOCTRINE).toContain("30 to 80"); // paid price window
    expect(OPERATOR_DOCTRINE).toContain("dispute rate"); // the account-killer
    expect(OPERATOR_DOCTRINE.toLowerCase()).toContain("blended cpa"); // the honest number
    expect(OPERATOR_DOCTRINE.toLowerCase()).toContain("contribution margin");
  });

  it("keeps the diagnose-before-prescribe discipline explicit", () => {
    expect(OPERATOR_DOCTRINE.toLowerCase()).toContain("diagnose before you prescribe");
    expect(OPERATOR_DOCTRINE.toLowerCase()).toContain("distribution problem");
  });

  it("is Urivo's own voice — no course branding lifted in", () => {
    // The knowledge is ours to use; the source's branding is not what we ship.
    expect(OPERATOR_DOCTRINE).not.toContain("OTS");
    expect(OPERATOR_DOCTRINE).not.toMatch(/module\s*\d/i);
  });

  it("holds the hype-free voice the assistant is required to keep", () => {
    // The same banned words the system prompt forbids in output must not be
    // modelled by the knowledge the model reads.
    const banned = ["Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash"];
    for (const word of banned) {
      expect(OPERATOR_DOCTRINE.toLowerCase()).not.toContain(word.toLowerCase());
    }
    expect(OPERATOR_DOCTRINE).not.toContain("!");
  });
});
