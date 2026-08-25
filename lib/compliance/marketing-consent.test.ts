import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Marketing consent must be OPT-IN: the effective column default for
 * profiles.marketing_opt_in is false. 0007 created it `default true`; 0061
 * re-defaults it to false. This test tracks the migrations themselves (in
 * order) rather than a copy of the schema, so it fails if a later migration
 * ever flips the default back — the same file-driven approach as the other
 * migration guards (no live database needed).
 */

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

/** The default (`true` | `false`) set by the LAST migration statement that
 *  defaults profiles.marketing_opt_in, scanning files in numeric order. */
function effectiveMarketingDefault(): "true" | "false" | null {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let current: "true" | "false" | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    // Matches both the create-column form (0007) and the alter-default form (0061).
    for (const m of sql.matchAll(/marketing_opt_in[^;]*default\s+(true|false)/gi)) {
      current = m[1].toLowerCase() as "true" | "false";
    }
  }
  return current;
}

describe("marketing consent is opt-in (default false)", () => {
  it("the effective marketing_opt_in default across all migrations is false", () => {
    expect(effectiveMarketingDefault()).toBe("false");
  });

  it("migration 0061 sets the default to false", () => {
    const sql = readFileSync(join(MIGRATIONS, "0061_marketing_opt_in_default_off.sql"), "utf8");
    expect(sql).toMatch(/alter column marketing_opt_in set default false/i);
  });

  it("setup_all.sql carries the opt-in-off migration", () => {
    const setup = readFileSync(join(MIGRATIONS, "..", "setup_all.sql"), "utf8");
    expect(setup).toContain("0061_marketing_opt_in_default_off");
    expect(setup).toMatch(/alter column marketing_opt_in set default false/i);
  });
});
