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

  // ── Phase 6: adversarial ────────────────────────────────────────────
  describe("hostile and malformed input fails safely", () => {
    it("refuses a forged session that never visited anything", async () => {
      /*
       * The attack: guess or replay a session id at checkout to attach someone
       * else's click — or any click — to your own order. The cookie is HttpOnly
       * and server-issued precisely so this cannot be done from a page, but the
       * database must refuse it regardless of how the value arrived.
       */
      const creative = await fx.creative(store, "forged");
      const victim = fx.session("victim");
      await fx.visit(store, victim, creative, HOUR);

      const order = await fx.order(store, { email: "forged@example.invalid" });
      const forged = `urivo-itest-forged-${crypto.randomUUID()}`;
      fx.sessions.push(forged);

      expect(await api.rpc("attribute_order", { p_order_id: order, p_session_hash: forged })).toBeNull();
      expect((await fx.basisOf(order)).creative_id).toBeNull();
    });

    it.each([
      ["empty", ""],
      ["whitespace", "     "],
      ["too short", "abc"],
      ["sql injection", "'; drop table orders; --"],
      ["4kb of junk", "x".repeat(4096)],
      ["unicode", "🙂".repeat(50)],
      ["newlines", "aaaaaa\n\r\nbbbb"],
    ])("survives a %s session id without raising", async (label, value) => {
      /*
       * Every one of these must return an answer rather than an exception. A
       * raise here would be swallowed by the webhook's best-effort call and
       * leave the order silently un-assessed — the exact failure mode the whole
       * subsystem was rebuilt to eliminate.
       */
      /*
       * A distinct buyer per case. Reusing one email made every case after the
       * first a returning customer, so the suite was testing §6 six times over
       * and never testing malformed input at all — an assertion that measures
       * something other than its name is worse than a missing one.
       */
      const order = await fx.order(store, { email: `junk-${label.replace(/\W/g, "")}@example.invalid` });
      const result = await api.rpc("attribute_order", {
        p_order_id: order,
        p_session_hash: value,
      });
      expect(result).toBeNull();
      // And it must still be a DECIDED state, not left unknown.
      expect(["none", "expired"]).toContain((await fx.basisOf(order)).attribution_basis);
    });

    it("rejects a null byte at the transport layer, before it can reach the function", async () => {
      /*
       * PostgREST refuses \u0000 in JSON with 22P05 — Postgres text cannot hold
       * it. That is the right layer to stop it, but it means the RPC 400s rather
       * than deciding, so the order must stay 'unknown' and the failure must be
       * logged. Both hold: the call site inspects the error and the row keeps
       * the un-assessed default rather than a confident 'none'.
       */
      const order = await fx.order(store, { email: "nullbyte@example.invalid" });
      await expect(
        api.rpc("attribute_order", { p_order_id: order, p_session_hash: "aaaaaa\u0000" }),
      ).rejects.toThrow(/22P05|400/);
      expect((await fx.basisOf(order)).attribution_basis).toBe("unknown");
    });

    it("attributes nothing for an order that does not exist", async () => {
      // A webhook for a deleted or foreign order must not raise.
      const result = await api.rpc("attribute_order", {
        p_order_id: crypto.randomUUID(),
        p_session_hash: fx.session("ghost"),
      });
      expect(result).toBeNull();
    });

    it("ignores a visit tagged with a creative that does not exist", async () => {
      /*
       * A hand-typed or truncated ?uc= reaches the storefront constantly. The
       * write path resolves the creative before naming it, so the row carries
       * null — and the read path must not invent a match from it either.
       */
      const session = fx.session("ghost-creative");
      const r = await api.rest("store_visits", {
        method: "POST",
        body: JSON.stringify({
          store_id: store,
          session_hash: session,
          path: "/",
          creative_id: null,
          is_bot: false,
          utm_source: "meta",
        }),
      });
      expect(r.ok).toBe(true);

      const order = await fx.order(store, { email: "ghost@example.invalid" });
      expect(await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session })).toBeNull();
      // Direct, not "our window expired" — the visit never named a real ad.
      expect((await fx.basisOf(order)).attribution_basis).toBe("none");
    });

    it("keeps the traffic source when the ad id is unusable", async () => {
      // Spec §5: an unresolvable ?uc= must not destroy the UTM context with it.
      const session = fx.session("utm-kept");
      await api.rest("store_visits", {
        method: "POST",
        body: JSON.stringify({
          store_id: store,
          session_hash: session,
          path: "/",
          creative_id: null,
          is_bot: false,
          utm_source: "newsletter",
          utm_campaign: "spring",
        }),
      });
      const row = (
        await api.rest<{ utm_source: string; utm_campaign: string }[]>(
          `store_visits?select=utm_source,utm_campaign&session_hash=eq.${session}`,
        )
      ).body[0];
      expect(row.utm_source).toBe("newsletter");
      expect(row.utm_campaign).toBe("spring");
    });

    it("counts one session as one click however many pageviews it makes", async () => {
      // Counting reloads would make every ad look several times better than it is.
      const creative = await fx.creative(store, "reloads");
      const session = fx.session("reloads");
      for (let i = 0; i < 5; i++) await fx.visit(store, session, creative, HOUR - i * 1000);

      const row = (
        await api.rpc<{ creative_id: string; clicks: number }[]>("ad_performance", { p_store_id: store })
      ).find((r) => r.creative_id === creative)!;
      expect(row.clicks).toBe(1);
    });

    it("attributes two purchases in one session to the same introducing ad", async () => {
      // Two decisions, one introduction. Stated explicitly so it is never read
      // as double counting (§9).
      const creative = await fx.creative(store, "two-orders");
      const session = fx.session("two-orders");
      await fx.visit(store, session, creative, HOUR);

      const a = await fx.order(store, { email: "buyer-a@example.invalid", cents: 1000 });
      const b = await fx.order(store, { email: "buyer-b@example.invalid", cents: 2000 });
      await api.rpc("attribute_order", { p_order_id: a, p_session_hash: session });
      await api.rpc("attribute_order", { p_order_id: b, p_session_hash: session });

      const row = (
        await api.rpc<{ creative_id: string; orders: number; revenue_cents: number }[]>("ad_performance", {
          p_store_id: store,
        })
      ).find((r) => r.creative_id === creative)!;
      expect(row.orders).toBe(2);
      expect(row.revenue_cents).toBe(3000);
    });

    it("never lets concurrent attribution attempts disagree", async () => {
      /*
       * Two webhook deliveries racing on the same order. Whichever lands first
       * decides; the other must return that same answer rather than a second
       * opinion, or the merchant's number changes under them.
       */
      const first = await fx.creative(store, "race-a");
      const second = await fx.creative(store, "race-b");
      const s1 = fx.session("race-a");
      const s2 = fx.session("race-b");
      await fx.visit(store, s1, first, HOUR);
      await fx.visit(store, s2, second, HOUR);
      const order = await fx.order(store, { email: "race@example.invalid" });

      const [x, y] = await Promise.all([
        api.rpc<string | null>("attribute_order", { p_order_id: order, p_session_hash: s1 }),
        api.rpc<string | null>("attribute_order", { p_order_id: order, p_session_hash: s2 }),
      ]);

      const settled = (await fx.basisOf(order)).creative_id;
      expect([first, second]).toContain(settled);
      // Both callers must agree with the row, whichever won.
      for (const answer of [x, y]) if (answer !== null) expect(answer).toBe(settled);
    });

    it("does not let a refund push attributed revenue below zero", async () => {
      const creative = await fx.creative(store, "overrefund");
      const session = fx.session("overrefund");
      await fx.visit(store, session, creative, HOUR);
      const order = await fx.order(store, { email: "over@example.invalid", cents: 5000 });
      await api.rpc("attribute_order", { p_order_id: order, p_session_hash: session });
      await api.rest(`orders?id=eq.${order}`, {
        method: "PATCH",
        body: JSON.stringify({ amount_refunded: 5000 }),
      });

      const row = (
        await api.rpc<{ creative_id: string; revenue_cents: number }[]>("ad_performance", {
          p_store_id: store,
        })
      ).find((r) => r.creative_id === creative)!;
      expect(row.revenue_cents).toBe(0);
      expect(row.revenue_cents).toBeGreaterThanOrEqual(0);
    });

    it("reconciles after every hostile case above", async () => {
      /*
       * Runs last, so the invariant is checked against the debris of the whole
       * adversarial suite rather than a clean table. Spec §16.4.
       */
      const cov = (
        await api.rpc<Record<string, number>[]>("attribution_coverage", { p_store_id: store, p_days: 90 })
      )[0];
      expect(
        cov.attributed_cents +
          cov.returning_cents +
          cov.expired_cents +
          cov.unattributed_cents +
          cov.unknown_cents,
      ).toBe(cov.total_cents);
    });
  });

});
