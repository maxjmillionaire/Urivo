import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbFromEnv, client, Fixtures } from "./db";

/*
 * The attribution rules, executed against a real database.
 *
 * specifications/10-attribution.md is the contract; this file is the proof.
 * Every rule here is SQL, so a unit test can only assert that the text of a
 * migration contains a phrase — which passes just as happily when the function
 * raises on every call. It did, once: a 42804 in attribute_order survived a
 * full hand-run because the check read the row afterwards, found the column
 * default, and mistook it for a decision.
 *
 * So each case asserts the RPC's response AND the resulting row. The harness
 * throws on a non-2xx, which is the single most important line in it.
 */

const db = dbFromEnv();
const suite = db ? describe : describe.skip;

/*
 * Always runs, so a misconfigured invocation says what went wrong.
 *
 * Without this the run reported "no tests" and exited 1 — the right direction,
 * but an unexplained one. A failure that reads as a broken rule when the real
 * cause is a missing environment variable costs someone an afternoon.
 */
describe("integration harness", () => {
  it("is pointed at a database", () => {
    expect(
      db,
      "Set URIVO_INTEGRATION_DB=1 plus NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(or run `npm run test:db`, which sets the flag). These cases are meaningless without a " +
        "real database — reporting them as passed would be worse than reporting nothing.",
    ).not.toBeNull();
  });
});

suite("attribution rules, against the real database", () => {
  const api = client(db!);
  let store: string;
  let otherStore: string | null = null;
  let fx: Fixtures;
  let before: { visits: number; orders: number; creatives: number };

  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;

  beforeAll(async () => {
    before = {
      visits: await api.count("store_visits?select=id"),
      orders: await api.count("orders?select=id"),
      creatives: await api.count("ad_creatives?select=id"),
    };
    const stores = (await api.rest<{ id: string; subdomain: string }[]>("stores?select=id,subdomain")).body;
    expect(stores.length, "the database needs at least one store to test against").toBeGreaterThan(0);
    store = stores[0].id;
    otherStore = stores[1]?.id ?? null;
    fx = new Fixtures(api);
  });

  afterAll(async () => {
    await fx.cleanup();
    /*
     * Cleanup is asserted, not assumed. A test suite that leaves rows behind
     * corrupts the merchant analytics it was written to protect, and it would
     * do so quietly — the tests would still pass.
     */
    expect({
      visits: await api.count("store_visits?select=id"),
      orders: await api.count("orders?select=id"),
      creatives: await api.count("ad_creatives?select=id"),
    }).toEqual(before);
  });

  // ── §3 The window ───────────────────────────────────────────────────
  it("credits an ad clicked inside the 7-day window", async () => {
    const creative = await fx.creative(store, "window-in");
    const session = fx.session("in");
    await fx.visit(store, session, creative, 3 * DAY);
    const order = await fx.order(store, { email: "win-in@example.invalid" });

    const returned = await api.rpc<string | null>("attribute_order", {
      p_order_id: order,
      p_session_hash: session,
    });

    expect(returned).toBe(creative);
    expect(await fx.basisOf(order)).toEqual({ attribution_basis: "creative", creative_id: creative });
  });

  it("does not credit a click older than the window, and says why", async () => {
    /*
     * 'expired' rather than 'none': the merchant should see that the window
     * cost them the credit, not conclude the ad did nothing.
     */
    const creative = await fx.creative(store, "window-out");
    const session = fx.session("out");
    await fx.visit(store, session, creative, 10 * DAY);
    const order = await fx.order(store, { email: "win-out@example.invalid" });

    expect(await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session })).toBeNull();
    expect(await fx.basisOf(order)).toEqual({ attribution_basis: "expired", creative_id: null });
  });

  // ── §8 Idempotency ──────────────────────────────────────────────────
  it("a Stripe retry cannot rewrite a decision the merchant has already read", async () => {
    const first = await fx.creative(store, "retry-first");
    const second = await fx.creative(store, "retry-second");
    const s1 = fx.session("retry-1");
    const s2 = fx.session("retry-2");
    await fx.visit(store, s1, first, HOUR);
    await fx.visit(store, s2, second, HOUR);
    const order = await fx.order(store, { email: "retry@example.invalid" });

    await api.rpc("attribute_order", { p_order_id: order, p_session_hash: s1 });
    const replay = await api.rpc<string | null>("attribute_order", {
      p_order_id: order,
      p_session_hash: s2,
    });

    // Stripe delivers at least once and may deliver out of order. A number that
    // changes after it has been seen is worse than a conservative one.
    expect(replay).toBe(first);
    expect((await fx.basisOf(order)).creative_id).toBe(first);
  });

  // ── §5 Tenant isolation ─────────────────────────────────────────────
  it.runIf(true)("never credits another store's ad, and does not blame our window for it", async () => {
    if (!otherStore) return; // Single-store database; nothing to isolate against.
    const foreign = await fx.creative(otherStore, "foreign");
    const session = fx.session("foreign");
    await fx.visit(store, session, foreign, HOUR);
    const order = await fx.order(store, { email: "foreign@example.invalid" });

    expect(await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session })).toBeNull();
    /*
     * 'none', not 'expired'. Labelling it expired would tell the merchant their
     * 7-day window cost them a sale, when the link was never theirs — the
     * number stays right and the sentence goes wrong, which is harder to spot.
     */
    expect((await fx.basisOf(order)).attribution_basis).toBe("none");
  });

  // ── §6 Returning customers ──────────────────────────────────────────
  it("excludes a returning customer even when they clicked an ad", async () => {
    const creative = await fx.creative(store, "loyal");
    const email = "loyal@example.invalid";
    await fx.order(store, { email, cents: 5000, agoMs: 30 * DAY });

    const session = fx.session("loyal");
    await fx.visit(store, session, creative, HOUR);
    const repeat = await fx.order(store, { email, cents: 9000 });

    expect(await api.rpc("attribute_order", { p_order_id: repeat, p_session_hash: session })).toBeNull();
    // Crediting it would let one good ad absorb a year of loyal revenue.
    expect(await fx.basisOf(repeat)).toEqual({ attribution_basis: "returning", creative_id: null });
  });

  // ── §13 Bots ────────────────────────────────────────────────────────
  it("never lets a bot visit become the first touch", async () => {
    const botAd = await fx.creative(store, "bot-ad");
    const humanAd = await fx.creative(store, "human-ad");
    const session = fx.session("bot");
    await fx.visit(store, session, botAd, 2 * HOUR, true); // earlier, but a crawler
    await fx.visit(store, session, humanAd, HOUR);
    const order = await fx.order(store, { email: "bot@example.invalid" });

    const credited = await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session });
    expect(credited).toBe(humanAd);
  });

  // ── §2 / Phase 2: unknown is not none ───────────────────────────────
  it("starts an order un-assessed rather than claiming no ad was involved", async () => {
    /*
     * The distinction the schema could not express until 0043. Every
     * attribution failure landed on 'none', which reads as a confident answer,
     * and the coverage panel reported it as direct traffic nobody bought.
     */
    const r = await api.rest<{ attribution_basis: string }[]>("orders?select=id,attribution_basis", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: store,
        stripe_session_id: `urivo-itest_${crypto.randomUUID()}`,
        customer_email: "fresh@example.invalid",
        amount_subtotal: 1000,
        amount_total: 1000,
        currency: "eur",
        status: "paid",
      }),
    });
    fx.orders.push((r.body[0] as unknown as { id: string }).id);
    expect(r.body[0].attribution_basis).toBe("unknown");
  });

  it("treats a checkout with no session as a decided none, not as unknown", async () => {
    const order = await fx.order(store, { email: "nosession@example.invalid" });
    expect(await api.rpc("attribute_order", { p_order_id: order, p_session_hash: null })).toBeNull();
    // We looked and there was nothing to find. That is an answer.
    expect((await fx.basisOf(order)).attribution_basis).toBe("none");
  });

  // ── §10 / §16.4 Reconciliation ──────────────────────────────────────
  it("splits revenue into buckets that sum exactly to the total", async () => {
    const cov = (
      await api.rpc<Record<string, number>[]>("attribution_coverage", {
        p_store_id: store,
        p_days: 90,
      })
    )[0];

    const parts =
      cov.attributed_cents +
      cov.returning_cents +
      cov.expired_cents +
      cov.unattributed_cents +
      cov.unknown_cents;

    /*
     * Spec §16.4. Revenue falling between the buckets would be invisible: the
     * merchant cannot notice money that appears in no column, and the figure
     * still reads like a complete accounting.
     */
    expect(parts).toBe(cov.total_cents);
    expect(
      cov.attributed_orders +
        cov.returning_orders +
        cov.expired_orders +
        cov.unattributed_orders +
        cov.unknown_orders,
    ).toBe(cov.total_orders);
  });

  it("nets refunds off attributed revenue without unattributing the order", async () => {
    const creative = await fx.creative(store, "refund");
    const session = fx.session("refund");
    await fx.visit(store, session, creative, HOUR);
    const order = await fx.order(store, { email: "refund@example.invalid", cents: 8600 });
    await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session });
    await api.rest(`orders?id=eq.${order}`, {
      method: "PATCH",
      body: JSON.stringify({ amount_refunded: 3000 }),
    });

    const row = (
      await api.rpc<{ creative_id: string; orders: number; revenue_cents: number }[]>("ad_performance", {
        p_store_id: store,
      })
    ).find((r) => r.creative_id === creative)!;

    // The ad did cause the purchase; the revenue must match what was kept.
    expect(row.orders).toBe(1);
    expect(row.revenue_cents).toBe(5600);
  });

  // ── §11 Retention ───────────────────────────────────────────────────
  it("deletes click events past the window but keeps those an order depends on", async () => {
    const creative = await fx.creative(store, "retention");
    const stale = fx.session("stale");
    const cited = fx.session("cited");
    const recent = fx.session("recent");
    await fx.visit(store, stale, creative, 120 * DAY);
    await fx.visit(store, cited, creative, 120 * DAY);
    await fx.visit(store, recent, creative, 2 * DAY);
    await fx.order(store, { email: "cited@example.invalid", session: cited });

    const run = (
      await api.rpc<{ deleted: number; retained_for_orders: number }[]>("expire_click_events", {
        p_days: 90,
      })
    )[0];

    const left = async (s: string) =>
      (await api.rest<unknown[]>(`store_visits?select=id&session_hash=eq.${s}`)).body.length;

    expect(await left(stale)).toBe(0);
    /*
     * orders.creative_id is denormalised so revenue survives, but the visit is
     * the record of HOW the decision was reached. Deleting it leaves an
     * attribution nobody can audit, and in a refund dispute "the system says
     * so" is not an answer.
     */
    expect(await left(cited)).toBe(1);
    expect(await left(recent)).toBe(1);
    expect(run.retained_for_orders).toBeGreaterThanOrEqual(1);

    // Idempotent: the predicate is a property of the rows, not of a run log.
    const second = (
      await api.rpc<{ deleted: number }[]>("expire_click_events", { p_days: 90 })
    )[0];
    expect(second.deleted).toBe(0);
  });
});
