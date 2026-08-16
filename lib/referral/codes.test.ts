import { describe, it, expect } from "vitest";
import {
  normalizeCode,
  isValidCodeFormat,
  codeDiscountRate,
  commissionFor,
  applyDiscount,
  CREATOR_COMMISSION_RATE,
  CREATOR_DISCOUNT_RATE,
} from "./codes";

/*
 * Referral money maths. Every function here decides what a creator earns or
 * what a customer pays, and until now none were covered — a rounding change or
 * an inverted rate would have shipped silently and been discovered by a
 * creator disputing their payout.
 */

describe("normalizeCode", () => {
  it("upper-cases and trims so codes match however they were typed", () => {
    expect(normalizeCode("  ots  ")).toBe("OTS");
    expect(normalizeCode("MaX10")).toBe("MAX10");
  });

  it("normalises the empty string without throwing", () => {
    expect(normalizeCode("   ")).toBe("");
  });
});

describe("isValidCodeFormat", () => {
  it("accepts ordinary creator codes", () => {
    expect(isValidCodeFormat("OTS")).toBe(true);
    expect(isValidCodeFormat("max10")).toBe(true);
  });

  it("rejects codes that are too short to be unguessable", () => {
    expect(isValidCodeFormat("A")).toBe(false);
    expect(isValidCodeFormat("")).toBe(false);
  });
});

describe("commissionFor", () => {
  it("pays 25% of the first payment by default", () => {
    expect(commissionFor(49)).toBeCloseTo(12.25, 2);
    expect(commissionFor(199)).toBeCloseTo(49.75, 2);
  });

  it("honours a per-creator rate when one is set", () => {
    expect(commissionFor(100, 0.3)).toBeCloseTo(30, 2);
    expect(commissionFor(100, 0)).toBe(0);
  });

  it("never returns a negative commission", () => {
    expect(commissionFor(0)).toBe(0);
    expect(commissionFor(-50)).toBeGreaterThanOrEqual(0);
  });

  it("rounds to cents rather than carrying float dust into a payout", () => {
    const c = commissionFor(33.33);
    expect(Number.isFinite(c)).toBe(true);
    expect(Math.round(c * 100) / 100).toBe(c);
  });

  it("keeps the default rate at the documented 25%", () => {
    expect(CREATOR_COMMISSION_RATE).toBe(0.25);
  });
});

describe("applyDiscount", () => {
  it("applies the customer discount", () => {
    expect(applyDiscount(49, 0.1)).toBeCloseTo(44.1, 2);
  });

  it("returns the full price at a zero rate", () => {
    expect(applyDiscount(49, 0)).toBe(49);
  });

  it("never produces a negative price", () => {
    expect(applyDiscount(49, 2)).toBeGreaterThanOrEqual(0);
  });

  it("rounds to cents", () => {
    const p = applyDiscount(33.33, 0.1);
    expect(Math.round(p * 100) / 100).toBe(p);
  });
});

describe("codeDiscountRate", () => {
  it("returns a rate within the allowed range at any date", () => {
    for (const d of [new Date("2026-01-01"), new Date("2026-08-10"), new Date("2027-06-01")]) {
      const r = codeDiscountRate(d);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(CREATOR_DISCOUNT_RATE);
    }
  });
});
