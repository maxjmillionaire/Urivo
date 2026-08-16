import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PLANS } from "./plans";

/*
 * Promises the product makes in public, checked against what it actually does.
 *
 * These are not style tests. Every case here is a number a visitor can read on
 * the marketing page and then verify inside the product within one minute — so
 * a mismatch is not a typo, it is Urivo lying to someone before they have paid
 * anything. All of them were mismatched at once: the pricing table promised 25
 * welcome credits, the FAQ on the same page said 20, and the database granted
 * 20. The first promise Urivo ever made to a new account was false.
 *
 * TypeScript cannot see into SQL, so the link between lib/plans.ts and the
 * migration that actually writes the credits has to be asserted by reading the
 * file. That is exactly the seam the drift went through.
 */

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const WELCOME_REASON = "'Free tier welcome credits'";

/** The migration that currently decides the welcome grant — the last one to write it. */
function effectiveWelcomeMigration(): { name: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const writers = files.filter((f) =>
    readFileSync(join(MIGRATIONS, f), "utf8").includes(WELCOME_REASON),
  );
  const name = writers[writers.length - 1];
  return { name, sql: readFileSync(join(MIGRATIONS, name), "utf8") };
}

describe("welcome credits — the first promise, kept", () => {
  it("grants in SQL exactly what the pricing table advertises", () => {
    const { name, sql } = effectiveWelcomeMigration();

    /*
     * The amount is required to live in a named constant rather than inline in
     * the INSERT. Not decoration: it is what makes the value greppable from
     * here, and an inline literal is how the number came to exist in three
     * places that disagreed.
     */
    const declared = sql.match(/v_welcome_credits\s+constant\s+integer\s*:=\s*(\d+)/);
    expect(
      declared,
      `${name} must declare "v_welcome_credits constant integer := N" so the ` +
        `amount stays checkable from TypeScript`,
    ).not.toBeNull();

    expect(
      Number(declared![1]),
      `${name} grants ${declared![1]} welcome credits but PLANS.free.signupCredits ` +
        `promises ${PLANS.free.signupCredits}. A new account would read one number ` +
        `on the pricing page and find another in their balance.`,
    ).toBe(PLANS.free.signupCredits);
  });

  it("writes the grant in one place only, so there is nothing to keep in step", () => {
    const { sql } = effectiveWelcomeMigration();
    // The INSERT must use the constant, not repeat the number next to it.
    const inserts = sql.match(/insert into public\.credit_ledger[\s\S]*?;/g) ?? [];
    const welcome = inserts.filter((i) => i.includes(WELCOME_REASON));
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toContain("v_welcome_credits");
  });
});

describe("the landing page's public claims match the plans", () => {
  const landing = readFileSync(join(__dirname, "..", "app", "(platform)", "page.tsx"), "utf8");

  /*
   * The FAQ is built from PLANS and CREDIT_COSTS by template literal. If anyone
   * types a bare credit figure back into it, the copy can drift from the
   * product again silently — which is the whole failure this file exists for.
   */
  it("states credit figures by interpolation, never as typed-in numbers", () => {
    const faq = landing.slice(landing.indexOf("const FAQ"), landing.indexOf("export default"));
    expect(faq).toContain("${PLANS.free.signupCredits}");
    expect(faq).toContain("${CREDIT_COSTS.storeGeneration}");
    expect(faq).toContain("${CREDIT_COSTS.askMessage}");
    // A digit followed by "credit" is a hardcoded price promise.
    expect(faq).not.toMatch(/\d+\s+(free\s+)?credits?\b/);
  });

  /*
   * Free was deliberately given a live store: a user who has never owned
   * anything does not pay to keep it. Copy that says otherwise sends the free
   * tier's whole purpose backwards, and it survived on the page for months.
   */
  it("never tells free users they must upgrade to publish", () => {
    expect(PLANS.free.features.publish).toBe(true);
    expect(PLANS.free.maxLiveStores).toBe(1);
    expect(landing).not.toMatch(/upgrade to go live/i);
  });

  it("does not restrict custom domains to Pro — Founder has them too", () => {
    expect(landing).not.toMatch(/On Pro you can also connect/i);
  });
});
