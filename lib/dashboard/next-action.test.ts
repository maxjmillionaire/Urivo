import { describe, it, expect } from "vitest";
import {
  pickNextAction,
  NEXT_ACTION_GATES,
  type NextActionFacts,
  type DeviceConversion,
} from "./next-action";

/*
 * Next Action V1 — the selector is pure, so every merchant state is asserted
 * directly. Two things matter most: the activation ladder is correct for a
 * brand-new merchant with no analytics, and the performance lane NEVER fires
 * without enough real, well-covered data (no fabricated certainty).
 */

const base: NextActionFacts = {
  storeCount: 1,
  publishedCount: 1,
  canPublish: true,
  paymentsConnected: true,
  liveWithoutPayments: 0,
  primaryStoreId: "store-1",
  visitors7d: 100,
  ordersTotal: 50,
  lowCredits: false,
  device: null,
};

const device = (o: Partial<DeviceConversion>): DeviceConversion => ({
  mobileSessions: 500,
  mobileOrders: 25,
  desktopSessions: 500,
  desktopOrders: 25,
  coveragePct: 80,
  ...o,
});

describe("activation ladder", () => {
  it("no store → create a store", () => {
    const a = pickNextAction({ ...base, storeCount: 0, publishedCount: 0 });
    expect(a.kind).toBe("create_store");
    expect(a.action.href).toBe("/dashboard");
  });

  it("store built, none live, can publish → publish", () => {
    const a = pickNextAction({ ...base, publishedCount: 0 });
    expect(a.kind).toBe("publish_store");
    expect(a.action.href).toBe("/dashboard/stores/store-1");
  });

  it("store built, none live, cannot publish (Free) → upgrade to publish", () => {
    const a = pickNextAction({ ...base, publishedCount: 0, canPublish: false });
    expect(a.kind).toBe("upgrade_to_publish");
    expect(a.action.href).toBe("/dashboard/billing");
  });

  it("live but payments not connected → connect Stripe", () => {
    const a = pickNextAction({ ...base, paymentsConnected: false, liveWithoutPayments: 1, ordersTotal: 0, visitors7d: 0 });
    expect(a.kind).toBe("connect_stripe");
    expect(a.action.href).toBe("/dashboard/billing");
  });

  it("ready to sell, no traffic → get first visitor", () => {
    const a = pickNextAction({ ...base, ordersTotal: 0, visitors7d: 0 });
    expect(a.kind).toBe("first_visitor");
    expect(a.action.href).toBe("/dashboard/ads");
  });

  it("traffic but no sales → convert traffic", () => {
    const a = pickNextAction({ ...base, ordersTotal: 0, visitors7d: 80 });
    expect(a.kind).toBe("convert_traffic");
    expect(a.action.href).toBe("/dashboard/stores/store-1");
  });
});

describe("performance lane — gated, never fabricated", () => {
  it("fires with a credible, well-covered mobile shortfall, using REAL numbers", () => {
    const a = pickNextAction({
      ...base,
      ordersTotal: 60,
      device: device({ mobileOrders: 5, desktopOrders: 25 }), // 1% vs 5% → 80% below
    });
    expect(a.kind).toBe("fix_mobile_conversion");
    expect(a.reason).toContain("50%"); // mobile share (500/1000)
    expect(a.reason).toContain("80%"); // relative gap
    expect(a.action.label).toBe("Review");
  });

  it("does NOT fire below the sample gate → keep growing + honest early signal", () => {
    const a = pickNextAction({
      ...base,
      ordersTotal: 40,
      device: device({ mobileSessions: 50, desktopSessions: 50, mobileOrders: 0, desktopOrders: 3 }),
    });
    expect(a.kind).toBe("keep_growing");
    expect(a.watching.some((w) => w.title === "Early signal")).toBe(true);
  });

  it("does NOT fire when attribution coverage is too low", () => {
    const a = pickNextAction({
      ...base,
      ordersTotal: 60,
      device: device({ mobileOrders: 5, desktopOrders: 25, coveragePct: 40 }),
    });
    expect(a.kind).toBe("keep_growing");
  });

  it("does NOT fire when there aren't enough orders yet", () => {
    const a = pickNextAction({
      ...base,
      ordersTotal: NEXT_ACTION_GATES.minOrdersForPerformance - 1,
      device: device({ mobileOrders: 5, desktopOrders: 25 }),
    });
    expect(a.kind).toBe("keep_growing");
  });

  it("does NOT fire when mobile and desktop convert the same", () => {
    const a = pickNextAction({ ...base, ordersTotal: 60, device: device({ mobileOrders: 25, desktopOrders: 25 }) });
    expect(a.kind).toBe("keep_growing");
    expect(a.watching.some((w) => w.title === "Early signal")).toBe(false);
  });

  it("selling with no device data at all → keep growing, never crashes", () => {
    const a = pickNextAction({ ...base, ordersTotal: 200, device: null });
    expect(a.kind).toBe("keep_growing");
  });
});

describe("safety", () => {
  it("no activation/growth message asserts a percentage it didn't measure", () => {
    for (const a of [
      pickNextAction({ ...base, storeCount: 0 }),
      pickNextAction({ ...base, publishedCount: 0 }),
      pickNextAction({ ...base, ordersTotal: 200, device: null }),
    ]) {
      expect(a.reason).not.toMatch(/\d+%/);
    }
  });

  it("surfaces at most two watching items", () => {
    const a = pickNextAction({
      ...base,
      lowCredits: true,
      liveWithoutPayments: 2,
      ordersTotal: 40,
      device: device({ mobileSessions: 50, desktopSessions: 50, mobileOrders: 0, desktopOrders: 3 }),
    });
    expect(a.watching.length).toBeLessThanOrEqual(2);
  });

  it("low credits surfaces as a watching note, not the primary move", () => {
    const a = pickNextAction({ ...base, lowCredits: true });
    expect(a.kind).not.toBe("create_store");
    expect(a.watching.some((w) => w.title === "Credits running low")).toBe(true);
  });
});
