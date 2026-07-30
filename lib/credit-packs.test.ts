import { describe, it, expect } from "vitest";
import {
  CREDIT_PACKS,
  CREDIT_PACK_ORDER,
  getCreditPack,
  perCredit,
  savingsPct,
  packStores,
} from "./credit-packs";

describe("credit packs — pricing invariants (revenue-critical)", () => {
  it("resolves valid packs and rejects unknown ids", () => {
    expect(getCreditPack("boost")?.credits).toBe(20);
    expect(getCreditPack("studio")?.credits).toBe(60);
    expect(getCreditPack("scale")?.credits).toBe(150);
    expect(getCreditPack("nope")).toBeNull();
    expect(getCreditPack("")).toBeNull();
  });

  it("per-credit price genuinely falls at every step (a real volume discount, not a fake one)", () => {
    const order = CREDIT_PACK_ORDER.map((id) => CREDIT_PACKS[id]);
    for (let i = 1; i < order.length; i++) {
      expect(perCredit(order[i])).toBeLessThan(perCredit(order[i - 1]));
    }
  });

  it("savings are honest: never negative, Boost is the 0 baseline, larger packs save more", () => {
    expect(savingsPct(CREDIT_PACKS.boost)).toBe(0);
    for (const id of CREDIT_PACK_ORDER) {
      expect(savingsPct(CREDIT_PACKS[id])).toBeGreaterThanOrEqual(0);
    }
    expect(savingsPct(CREDIT_PACKS.scale)).toBeGreaterThan(savingsPct(CREDIT_PACKS.studio));
  });

  it("every pack's per-credit price stays ABOVE the Founder subscription rate (packs never cannibalise plans)", () => {
    const founderPerCredit = 39 / 150; // €39 launch / 150 monthly credits
    for (const id of CREDIT_PACK_ORDER) {
      expect(perCredit(CREDIT_PACKS[id])).toBeGreaterThan(founderPerCredit);
    }
  });

  it("packStores divides credits by the 20-credit generation cost", () => {
    expect(packStores(CREDIT_PACKS.boost)).toBe(1); // 20 / 20
    expect(packStores(CREDIT_PACKS.scale)).toBe(7); // floor(150 / 20)
  });
});
