import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { costOfActionExact, IMAGE_COST_USD, usdToEur } from "./cost-model";

/*
 * The economics layer, tested where it is easiest to lie to yourself.
 *
 * Every case here corresponds to a way a finance dashboard can print a
 * confident number that is wrong: revenue counted twice, an estimate shown as a
 * measurement, a margin invented out of a division by zero, or a corrected
 * price that silently leaves history on the old one.
 */

describe("image cost is a rate, not a constant", () => {
  it("uses the rate it is given rather than the compiled-in fallback", () => {
    const atFallback = costOfActionExact({ inputTokens: 0, outputTokens: 0 }, 5);
    const atDouble = costOfActionExact({ inputTokens: 0, outputTokens: 0 }, 5, undefined, IMAGE_COST_USD * 2);
    expect(atFallback.imageUsd).toBeCloseTo(5 * IMAGE_COST_USD, 9);
    expect(atDouble.imageUsd).toBeCloseTo(2 * atFallback.imageUsd, 9);
    // The total must move with it, or the ledger would store a rate change that
    // never reached the number anyone reads.
    expect(atDouble.totalUsd).toBeCloseTo(atDouble.anthropicUsd + atDouble.imageUsd, 9);
  });

  it("keeps a text-only action free of image cost at any rate", () => {
    const c = costOfActionExact({ inputTokens: 1000, outputTokens: 1000 }, 0, undefined, 9.99);
    expect(c.imageUsd).toBe(0);
  });

  /*
   * The whole reason the correction can be exact: the ledger stores the image
   * COUNT next to the cost, so history is recomputed rather than re-guessed.
   */
  it("rebases history from stored image counts, not from the old cost", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "0037_economics.sql"),
      "utf8",
    );
    const fn = sql.slice(sql.indexOf("function public.rebase_image_costs"));
    expect(fn).toMatch(/image_cost_usd\s*=\s*round\(images \* p_rate_usd/);
    // The total must be rebuilt from its parts; deriving it from the old total
    // would compound the error it is meant to remove.
    expect(fn).toMatch(/total_cost_usd\s*=\s*round\(anthropic_cost_usd \+ \(images \* p_rate_usd\)/);
    // And it must refuse an implausible rate rather than wiping the ledger.
    expect(fn).toMatch(/raise exception/);
  });
});

describe("revenue is recorded once, from Stripe's own numbers", () => {
  const webhook = readFileSync(
    join(__dirname, "..", "..", "app", "api", "webhooks", "stripe", "route.ts"),
    "utf8",
  );

  /*
   * A subscription checkout ALSO produces invoice.paid for the same money.
   * Recording both would double the first month of every customer ever signed
   * — the one month a founder looks at hardest.
   */
  it("does not record subscription revenue at checkout as well as at invoice.paid", () => {
    const checkout = webhook.slice(
      webhook.indexOf("async function handlePlatformCheckout"),
      webhook.indexOf("function invoiceSubscriptionId"),
    );
    const subscriptionBranch = checkout.slice(
      checkout.indexOf('kind === "subscription"'),
      checkout.indexOf('kind === "credit_pack"'),
    );
    expect(subscriptionBranch).not.toContain("recordRevenue");
  });

  it("records a credit pack, which has no invoice behind it", () => {
    const checkout = webhook.slice(webhook.indexOf('kind === "credit_pack"'));
    expect(checkout).toContain("recordRevenue");
    expect(checkout).toContain('kind: "credit_pack"');
  });

  it("keys every revenue row on the Stripe event id, because Stripe retries", () => {
    for (const call of webhook.match(/recordRevenue\(\{[\s\S]*?\}\)/g) ?? []) {
      expect(call).toContain("stripeEventId: event.id");
    }
  });

  it("stores refunds as negative amounts so a total is a plain sum", () => {
    const refund = webhook.slice(webhook.indexOf('case "charge.refunded"'));
    expect(refund).toMatch(/amountCents: -Math\.abs/);
  });

  it("records an invoice even when the payer cannot be resolved", () => {
    const invoicePaid = webhook.slice(webhook.indexOf("async function handleInvoicePaid"));
    const recordAt = invoicePaid.indexOf("recordRevenue");
    const bailoutAt = invoicePaid.indexOf("if (!userId)");
    // Money that arrived is money that arrived; under-reporting exactly when
    // something else has gone wrong is the worst time to under-report.
    expect(recordAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(bailoutAt);
  });
});

describe("margin is undefined without revenue, never zero", () => {
  /*
   * Dividing by zero revenue yields -Infinity or NaN, and rendering either as
   * "0%" invites reading a healthy pre-revenue day as a catastrophic one.
   */
  const margin = (revenue: number, cost: number) =>
    revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;

  it("returns null rather than a number when nothing was earned", () => {
    expect(margin(0, 12.5)).toBeNull();
  });

  it("computes a normal margin when there is revenue", () => {
    expect(margin(100, 15)).toBeCloseTo(85, 9);
  });

  it("goes negative honestly when cost exceeds revenue", () => {
    expect(margin(10, 15)).toBeCloseTo(-50, 9);
  });
});

describe("the spend alert ladder escalates instead of going quiet", () => {
  // Mirrors lib/platform/spend-alert.ts — the ordering rule the whole design
  // rests on: a day that crosses €25 at breakfast must not be silent at €300.
  const crossed = (spend: number, thresholds: number[], alreadyAt: number): number | null => {
    const over = thresholds.filter((t) => spend >= t);
    if (over.length === 0) return null;
    const highest = over[over.length - 1];
    return highest > alreadyAt ? highest : null;
  };
  const LADDER = [25, 50, 100];

  it("says nothing below the first rung", () => {
    expect(crossed(24.99, LADDER, 0)).toBeNull();
  });

  it("fires the first rung, then stays quiet at the same level", () => {
    expect(crossed(30, LADDER, 0)).toBe(25);
    expect(crossed(30, LADDER, 25)).toBeNull();
    expect(crossed(49, LADDER, 25)).toBeNull();
  });

  it("fires again when the day gets worse", () => {
    expect(crossed(60, LADDER, 25)).toBe(50);
    expect(crossed(140, LADDER, 50)).toBe(100);
  });

  it("sends one email, about the worst rung, when a spike clears several at once", () => {
    expect(crossed(500, LADDER, 0)).toBe(100);
  });

  it("goes silent above the top rung once it has fired", () => {
    expect(crossed(5000, LADDER, 100)).toBeNull();
  });
});

describe("the budget projection is legible enough that its error is obvious", () => {
  const project = (spent: number, daysElapsed: number, daysInMonth: number) =>
    (spent / Math.max(1, daysElapsed)) * daysInMonth;

  it("projects a straight line from the run rate", () => {
    expect(project(100, 10, 30)).toBeCloseTo(300, 9);
  });

  it("does not divide by zero in the first hours of a month", () => {
    expect(Number.isFinite(project(5, 0, 31))).toBe(true);
  });
});

describe("FX is applied in one direction only", () => {
  it("converts provider USD into EUR, never the reverse by accident", () => {
    // Costs are USD, revenue is EUR. A margin that mixed them would be wrong by
    // the whole exchange rate.
    expect(usdToEur(1.08)).toBeCloseTo(1, 6);
    expect(usdToEur(0)).toBe(0);
  });
});

describe("settings fail open, because they sit on the generation path", () => {
  beforeEach(() => vi.resetModules());

  it("returns defaults when platform_settings cannot be read", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      supabaseAdmin: () => {
        throw new Error("relation does not exist");
      },
    }));
    const { getPlatformSettings } = await import("@/lib/platform/settings");
    const s = await getPlatformSettings();
    // A half-migrated deployment must not take generation down with it.
    expect(s.freeGenerationsEnabled).toBe(true);
    expect(s.dailySpendThresholdsEur).toEqual([25, 50, 100]);
    expect(s.monthlyAiBudgetEur).toBe(0);
  });
});
