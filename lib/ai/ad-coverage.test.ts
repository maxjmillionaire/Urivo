import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { explainCoverage, type AttributionCoverage } from "./ad-performance";

/*
 * Spec 10 §14. Coverage is the number that makes every other number
 * trustworthy, which means a wrong coverage figure is worse than none: it
 * looks like arithmetic, so nobody checks it.
 */

const eur = (orders: number, revenueEUR: number) => ({ orders, revenueEUR });

const cov = (over: Partial<AttributionCoverage> = {}): AttributionCoverage => ({
  attributed: eur(3, 258),
  returning: eur(2, 180),
  expired: eur(1, 90),
  unattributed: eur(1, 70),
  unknown: eur(0, 0),
  total: eur(7, 598),
  coveragePct: 43.1,
  days: 30,
  available: true,
  ...over,
});

describe("the split always accounts for every euro", () => {
  it("the buckets sum to the total", () => {
    /*
     * Spec §16.4. Revenue that falls between the buckets would be invisible —
     * a merchant cannot notice money that appears in no column, and the figure
     * still reads like a complete accounting.
     */
    const c = cov();
    const parts =
      c.attributed.revenueEUR +
      c.returning.revenueEUR +
      c.expired.revenueEUR +
      c.unattributed.revenueEUR +
      c.unknown.revenueEUR;
    expect(parts).toBe(c.total.revenueEUR);
  });

  it("names every basis explicitly in SQL rather than sweeping one up in an else", () => {
    /*
     * If a future attribution basis is added and the function is not updated,
     * its revenue must go MISSING and break the sum loudly — not be silently
     * absorbed into "direct" and reported as traffic the merchant never bought.
     */
    const sql = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "0043_attribution_unknown.sql"),
      "utf8",
    );
    for (const basis of ["creative", "returning", "expired", "none", "unknown"]) {
      expect(sql).toMatch(new RegExp(`filter \\(where basis = '${basis}'\\)`));
    }
    /*
     * Scoped to the coverage function alone. The same migration also defines
     * attribute_order, whose plpgsql body uses if/else legitimately — judging
     * the whole file would fail on unrelated, correct code.
     *
     * Comments stripped too: they discuss the very else-branch this forbids,
     * so matching them would pass or fail on wording rather than on SQL.
     */
    const fn = sql.slice(sql.indexOf("function public.attribution_coverage"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(code).toMatch(/filter \(where basis = 'unknown'\)/);
    expect(code).not.toMatch(/\belse\b/i);
  });

  it("computes coverage on revenue net of refunds", () => {
    // Coverage against gross would credit ads with money that was returned.
    const sql = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "0040_attribution_coverage.sql"),
      "utf8",
    );
    expect(sql).toMatch(/amount_total - coalesce\(o\.amount_refunded, 0\)/);
  });
});

describe("the gap is explained, not just measured", () => {
  it("names returning customers when they dominate the gap", () => {
    const out = explainCoverage(cov({ returning: eur(9, 900), total: eur(16, 1318) }))!;
    expect(out).toMatch(/returning customers/i);
    expect(out).toMatch(/not an ad result/i);
  });

  it("names a missing tracked link when that dominates", () => {
    const out = explainCoverage(cov({ unattributed: eur(9, 900), total: eur(16, 1318) }))!;
    expect(out).toMatch(/without a tracked link/i);
    expect(out).toMatch(/plain store address/i);
  });

  it("names the window when the clicks were simply too old", () => {
    const out = explainCoverage(cov({ expired: eur(9, 900), total: eur(16, 1318) }))!;
    expect(out).toMatch(/more than 7 days after the click/i);
  });

  it("states the uncredited amount, not just the reason", () => {
    // "Some revenue is missing" is not a number a merchant can act on.
    expect(explainCoverage(cov())!).toMatch(/€340\.00/);
  });

  it("says so plainly when nothing is missing", () => {
    const out = explainCoverage(
      cov({ attributed: eur(7, 598), returning: eur(0, 0), expired: eur(0, 0), unattributed: eur(0, 0), unknown: eur(0, 0) }),
    )!;
    expect(out).toMatch(/every sale in this period is joined/i);
  });

  it("stays silent rather than guessing when the figure is unavailable", () => {
    expect(explainCoverage(cov({ available: false }))).toBeNull();
  });

  it("stays silent when there are no orders to explain", () => {
    expect(explainCoverage(cov({ total: eur(0, 0) }))).toBeNull();
  });
});

describe("an unreadable coverage figure never reads as zero", () => {
  it("distinguishes 'could not be read' from 'nothing happened'", () => {
    /*
     * The failure this prevents: an unapplied migration rendering as 0%
     * coverage, which a merchant reads as "none of my sales came from ads" —
     * the opposite of "we do not know".
     */
    const ui = readFileSync(
      join(__dirname, "..", "..", "app", "(platform)", "dashboard", "ads", "ad-studio.tsx"),
      "utf8",
    );
    expect(ui).toMatch(/coverage\?\.available && coverage\.total\.orders > 0/);
    expect(ui).toMatch(/Coverage could not be read/);
    expect(ui).toMatch(/floor rather/);
  });

  it("never shows a percentage it does not have", () => {
    const ui = readFileSync(
      join(__dirname, "..", "..", "app", "(platform)", "dashboard", "ads", "ad-studio.tsx"),
      "utf8",
    );
    // Null coverage renders as an em dash, never as 0%.
    expect(ui).toMatch(/coverage\.coveragePct === null \? "—"/);
  });
});
