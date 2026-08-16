import { describe, it, expect, vi, beforeEach } from "vitest";
import { shopperNotice, merchantNotice, type SellBlocker } from "./readiness";

/*
 * Payment readiness decides whether a shopper is allowed to reach a checkout
 * that can complete. It used to be discovered only AFTER the cart — the point
 * of maximum invested effort and zero recovery — so the rules that replace
 * that moment are worth pinning.
 *
 * The loader itself is exercised against a stubbed client below; the notice
 * copy is pure and gets asserted directly, because what a shopper is told about
 * a merchant's private setup is a real boundary.
 */

const BLOCKERS: SellBlocker[] = ["platform", "no_account", "charges_disabled"];

describe("what the shopper is told", () => {
  it("never leaks the merchant's payment setup to a customer", () => {
    for (const b of BLOCKERS) {
      const { title, detail } = shopperNotice(b);
      const text = `${title} ${detail}`.toLowerCase();
      // A customer is owed a clear reason, not a look inside someone's admin.
      expect(text).not.toMatch(/stripe|connect|onboard|payout|account/);
    }
  });

  it("tells the shopper browsing still works, so they do not just leave", () => {
    for (const b of BLOCKERS) {
      const { detail } = shopperNotice(b);
      expect(detail.toLowerCase()).toMatch(/brows|collection/);
    }
  });

  it("distinguishes our outage from the merchant's unfinished setup", () => {
    expect(shopperNotice("platform").title).not.toBe(shopperNotice("no_account").title);
  });
});

describe("what the merchant is told", () => {
  it("names the next step whenever there is one they can take", () => {
    expect(merchantNotice("no_account").action).toBe("Connect Stripe");
    expect(merchantNotice("charges_disabled").action).toBeTruthy();
  });

  it("does not ask the merchant to fix a platform outage", () => {
    const notice = merchantNotice("platform");
    expect(notice.action).toBeNull();
    expect(notice.detail.toLowerCase()).toContain("on our side");
  });

  it("says plainly that the store cannot take payment", () => {
    expect(merchantNotice("no_account").title.toLowerCase()).toContain("cannot accept payments");
  });
});

describe("storeSellReadiness fails closed", () => {
  beforeEach(() => vi.resetModules());

  /** Minimal stand-in for the admin client — only `rpc` is ever used. */
  const clientReturning = (result: unknown) =>
    ({ rpc: vi.fn().mockResolvedValue(result) }) as never;

  async function load(stripeConfigured: boolean) {
    vi.doMock("@/lib/commerce/stripe", () => ({ isStripeConfigured: () => stripeConfigured }));
    return (await import("./readiness")).storeSellReadiness;
  }

  it("refuses when Urivo has no Stripe keys, without querying at all", async () => {
    const storeSellReadiness = await load(false);
    const client = clientReturning({ data: [{ stripe_account_id: "acct_1", charges_enabled: true }] });
    const r = await storeSellReadiness(client, "store-1");
    expect(r.canSell).toBe(false);
    expect(r.blocker).toBe("platform");
  });

  it("allows a merchant with an account and charges enabled", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(
      clientReturning({ data: [{ stripe_account_id: "acct_1", charges_enabled: true }], error: null }),
      "store-1",
    );
    expect(r).toEqual({ canSell: true, blocker: null, accountId: "acct_1" });
  });

  it("refuses when onboarding was never started", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(
      clientReturning({ data: [{ stripe_account_id: null, charges_enabled: false }], error: null }),
      "store-1",
    );
    expect(r.canSell).toBe(false);
    expect(r.blocker).toBe("no_account");
  });

  it("refuses when the account exists but Stripe has not enabled charges", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(
      clientReturning({ data: [{ stripe_account_id: "acct_1", charges_enabled: false }], error: null }),
      "store-1",
    );
    expect(r.canSell).toBe(false);
    expect(r.blocker).toBe("charges_disabled");
    // The id is still returned — the merchant has somewhere to go and finish.
    expect(r.accountId).toBe("acct_1");
  });

  it("refuses on a query error rather than assuming the store can sell", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(
      clientReturning({ data: null, error: { message: "boom" } }),
      "store-1",
    );
    expect(r.canSell).toBe(false);
  });

  it("refuses when the RPC throws outright", async () => {
    const storeSellReadiness = await load(true);
    const client = { rpc: vi.fn().mockRejectedValue(new Error("network")) } as never;
    const r = await storeSellReadiness(client, "store-1");
    expect(r.canSell).toBe(false);
  });

  it("tolerates the RPC returning a bare object instead of a row array", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(
      clientReturning({ data: { stripe_account_id: "acct_9", charges_enabled: true }, error: null }),
      "store-1",
    );
    expect(r.canSell).toBe(true);
    expect(r.accountId).toBe("acct_9");
  });

  it("refuses on an empty result set", async () => {
    const storeSellReadiness = await load(true);
    const r = await storeSellReadiness(clientReturning({ data: [], error: null }), "store-1");
    expect(r.canSell).toBe(false);
    expect(r.blocker).toBe("no_account");
  });
});
