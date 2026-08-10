import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLANS, priceForUser } from "./plans";

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

  it("the public pricing card advertises the founding price, gated on the real counter", () => {
    /*
     * The Founding 50 offer was fully enforced in billing — migration 0023
     * claims a spot atomically at signup, /api/checkout reads price_type and
     * stamps the Stripe unit_amount — while the landing page advertised €49 and
     * €199 under a "Founder pricing" banner. The offer existed and no visitor
     * could see it.
     *
     * The cause was subtle: the card rendered price.launch against
     * price.regular, and those are equal for both paid tiers, so the
     * strike-through branch was unreachable and the discount silently never
     * appeared. The real discount lives in price.founding.
     */
    const landing = readFileSync(join(ROOT, "app", "(platform)", "page.tsx"), "utf8");
    const code = landing.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")).replace(/^\s*\/\/.*$/gm, "");

    expect(code, "the card must read the founding price").toMatch(/price\.founding/);
    expect(code, "the offer must be gated on the live counter, not a date").toMatch(/getFoundingOffer/);

    /*
     * price.launch must not drive the public discount. While launch equals
     * regular it renders nothing; if someone later sets it to a third value it
     * would advertise a price no checkout path can produce, because checkout
     * resolves standard-vs-founding from profiles.price_type.
     */
    expect(code, "price.launch must not drive the public discount").not.toMatch(/price\.launch/);
  });

  it("the founding prices shown publicly are the ones checkout charges", () => {
    // The invariant in one line: what the visitor reads is what the card pays.
    for (const key of ["core", "pro"] as const) {
      expect(priceForUser(key, "founding")).toBe(PLANS[key].price.founding);
      expect(priceForUser(key, "standard")).toBe(PLANS[key].price.regular);
    }
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
