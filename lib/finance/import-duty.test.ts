import { describe, it, expect } from "vitest";
import {
  importDutyEur,
  landedCostEur,
  marginAfterDuty,
  importDutyNote,
  isEuCountry,
  FLAT_DUTY_EUR,
  HANDLING_FEE_EUR,
} from "./import-duty";

const BEFORE = new Date("2026-06-30T12:00:00Z");
const AFTER_DUTY = new Date("2026-08-13T12:00:00Z");
const AFTER_HANDLING = new Date("2026-11-02T12:00:00Z");

describe("when the charge applies", () => {
  it("is nothing before 1 July 2026 — the exemption still existed", () => {
    expect(importDutyEur({ shipsFromCountry: "CN", now: BEFORE })).toBe(0);
  });

  it("is €3 once the exemption ends", () => {
    expect(importDutyEur({ shipsFromCountry: "CN", now: AFTER_DUTY })).toBe(FLAT_DUTY_EUR);
  });

  it("becomes €5 when the handling fee joins it", () => {
    expect(importDutyEur({ shipsFromCountry: "CN", now: AFTER_HANDLING })).toBe(
      FLAT_DUTY_EUR + HANDLING_FEE_EUR,
    );
  });
});

describe("who pays it", () => {
  it("charges nothing on goods already inside the EU", () => {
    for (const origin of ["DE", "de", "PL", "IE"]) {
      expect(importDutyEur({ shipsFromCountry: origin, now: AFTER_DUTY })).toBe(0);
    }
  });

  it("charges non-EU origin", () => {
    for (const origin of ["CN", "GB", "US", "TR"]) {
      expect(importDutyEur({ shipsFromCountry: origin, now: AFTER_DUTY })).toBe(FLAT_DUTY_EUR);
    }
  });

  it("treats unknown origin as an import, which is the safe direction", () => {
    // Under-stating cost sells at a loss the founder finds out about after the
    // ad spend. Over-stating costs a little volume. These are not symmetric.
    for (const origin of [null, undefined, "", "XX!", "CHINA"]) {
      expect(importDutyEur({ shipsFromCountry: origin, now: AFTER_DUTY })).toBe(FLAT_DUTY_EUR);
    }
  });

  it("models only EU destinations", () => {
    expect(importDutyEur({ shipsFromCountry: "CN", shipsToCountry: "US", now: AFTER_DUTY })).toBe(0);
    expect(importDutyEur({ shipsFromCountry: "CN", shipsToCountry: "FR", now: AFTER_DUTY })).toBe(FLAT_DUTY_EUR);
  });

  it("defaults the destination to Germany", () => {
    expect(importDutyEur({ shipsFromCountry: "CN", now: AFTER_DUTY })).toBe(FLAT_DUTY_EUR);
  });
});

describe("what it does to a real margin", () => {
  it("is the whole margin on a cheap product", () => {
    // The case that motivates this file: an €8 product at €24 looks like 67%.
    const naive = (24 - 8) / 24;
    expect(Math.round(naive * 100)).toBe(67);

    const real = marginAfterDuty(24, 8, { shipsFromCountry: "CN", now: AFTER_HANDLING });
    expect(Math.round(real! * 100)).toBe(46);
  });

  it("can turn a positive margin negative", () => {
    const real = marginAfterDuty(9, 6, { shipsFromCountry: "CN", now: AFTER_HANDLING });
    expect(real).toBeLessThan(0);
  });

  it("leaves EU-sourced margins untouched", () => {
    expect(marginAfterDuty(24, 8, { shipsFromCountry: "DE", now: AFTER_HANDLING })).toBeCloseTo(
      (24 - 8) / 24,
      10,
    );
  });

  it("reports no margin at all for a zero price rather than 0%", () => {
    expect(marginAfterDuty(0, 8)).toBeNull();
    expect(marginAfterDuty(-1, 8)).toBeNull();
  });

  it("adds the charge to landed cost", () => {
    expect(landedCostEur(8, { shipsFromCountry: "CN", now: AFTER_DUTY })).toBe(11);
    expect(landedCostEur(8, { shipsFromCountry: "DE", now: AFTER_DUTY })).toBe(8);
  });
});

describe("what the merchant is told", () => {
  it("says nothing when nothing is charged", () => {
    expect(importDutyNote({ shipsFromCountry: "DE", now: AFTER_DUTY })).toBeNull();
    expect(importDutyNote({ shipsFromCountry: "CN", now: BEFORE })).toBeNull();
  });

  it("names the amount and the reason, so the founder can check it", () => {
    const note = importDutyNote({ shipsFromCountry: "CN", now: AFTER_HANDLING });
    expect(note).toContain("€5");
    expect(note).toContain("1 July 2026");
  });
});

describe("country handling", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(isEuCountry(" de ")).toBe(true);
    expect(isEuCountry("Fr")).toBe(true);
  });

  it("does not treat a non-member as a member", () => {
    for (const c of ["GB", "CH", "NO", "TR", "US", "CN"]) expect(isEuCountry(c)).toBe(false);
  });

  it("counts 27 member states", () => {
    const eu = ["AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"];
    expect(eu.length).toBe(27);
    for (const c of eu) expect(isEuCountry(c)).toBe(true);
  });
});
