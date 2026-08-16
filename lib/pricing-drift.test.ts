import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLANS } from "./plans";

/*
 * Pricing drift.
 *
 * A price written into prose is a price nothing compares against what the
 * customer is actually charged. It has happened twice in this codebase: the
 * landing FAQ carried a stale credit figure, and the admin finance page carried
 * "Founder €29 / Pro €149" as a literal after the standard prices moved to €49
 * and €199. Neither broke anything, neither produced an error, and both would
 * have been read as authoritative.
 *
 * lib/plans.ts is the single source of truth — the same object Stripe pricing,
 * entitlement and the billing UI are driven from. These tests exist so a price
 * cannot silently exist anywhere else.
 */

const ROOT = join(__dirname, "..");

/** Every .ts/.tsx under app/ and lib/, excluding tests and the source of truth. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "lib"));
  return out.filter((f) => !f.endsWith(join("lib", "plans.ts")));
}

describe("the launch prices are what we agreed", () => {
  it("Free is free", () => {
    expect(PLANS.free.price.regular).toBe(0);
    expect(PLANS.free.price.launch).toBe(0);
  });

  it("Founder is €49 standard, €29 for the founding 50", () => {
    expect(PLANS.core.price.regular).toBe(49);
    expect(PLANS.core.price.launch).toBe(49);
    expect(PLANS.core.price.founding).toBe(29);
  });

  it("Pro is €199 standard, €149 for the founding 50", () => {
    expect(PLANS.pro.price.regular).toBe(199);
    expect(PLANS.pro.price.launch).toBe(199);
    expect(PLANS.pro.price.founding).toBe(149);
  });

  it("the founding price is always a discount, never above standard", () => {
    // A founding price that exceeded the standard one would silently overcharge
    // the very customers the discount is meant to reward.
    for (const plan of Object.values(PLANS)) {
      if (typeof plan.price.founding === "number") {
        expect(plan.price.founding).toBeLessThan(plan.price.regular);
      }
    }
  });

  it("the annual price is ten months, so 'two months free' stays true", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.price.annual).toBe(plan.price.regular * 10);
    }
  });
});

describe("no price is written anywhere but the source of truth", () => {
  /*
   * Matches a euro amount that equals one of our plan prices. Deliberately
   * narrow: it hunts for OUR numbers, not for every euro sign, so a cost
   * estimate or an example figure elsewhere does not produce noise.
   */
  const prices = [
    ...new Set(
      Object.values(PLANS).flatMap((p) =>
        [p.price.regular, p.price.launch, p.price.founding, p.price.annual].filter(
          (n): n is number => typeof n === "number" && n > 0,
        ),
      ),
    ),
  ];

  it("finds no hardcoded plan price in app/ or lib/", () => {
    const pattern = new RegExp(`€\\s?(${prices.join("|")})\\b`);
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      // Strip comments: explaining a price in a comment is not drift, and
      // forbidding it would push authors toward writing no explanation at all.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const [i, line] of code.split("\n").entries()) {
        if (pattern.test(line)) offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1} ${line.trim().slice(0, 90)}`);
      }
    }

    expect(offenders, `Interpolate from PLANS instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the admin founding line is derived, not typed", () => {
    // The exact regression this suite was written for.
    const admin = readFileSync(join(ROOT, "app", "(platform)", "admin", "finance", "page.tsx"), "utf8");
    expect(admin).toMatch(/foundingPrices\(\)/);
    /*
     * Judge the code, not the prose about it. The comment above the fix quotes
     * the old literal to explain what regressed, and forbidding that would push
     * authors toward leaving no explanation at all.
     */
    const code = admin.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/Founder €29 \/ Pro €149/);
  });
});
