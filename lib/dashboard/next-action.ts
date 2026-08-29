/*
 * Next Action — "What should I do next?" — V1.
 *
 * A PURE, deterministic selector. Given the real state of a merchant's business
 * (already assembled by buildDashboardOverview), it returns ONE primary move and
 * at most two small "worth watching" notes. No AI decides the recommendation; no
 * number is invented.
 *
 * Two lanes:
 *   1. ACTIVATION LADDER — works from day zero with no analytics: create →
 *      publish → connect payments → first visitor → convert traffic.
 *   2. PERFORMANCE — surfaces at most ONE data-grounded recommendation, and only
 *      behind an explicit sample + coverage gate. Below the gate it either stays
 *      on the ladder or shows an honest "early signal" note — never fabricated
 *      certainty.
 *
 * Isomorphic and side-effect free, so every state is unit-tested directly.
 */

export type NextActionKind =
  | "create_store"
  | "publish_store"
  | "upgrade_to_publish"
  | "connect_stripe"
  | "first_visitor"
  | "convert_traffic"
  | "fix_mobile_conversion"
  | "keep_growing";

/** Activation = getting the business off the ground; performance = data-grounded
 *  optimisation; growth = healthy, keep going. Drives only tone/wording. */
export type NextActionTone = "activation" | "performance" | "growth";

export interface NextActionButton {
  label: string;
  href: string;
}

export interface WatchItem {
  title: string;
  detail: string;
}

export interface NextAction {
  kind: NextActionKind;
  tone: NextActionTone;
  /** Verb-first, one line. */
  title: string;
  /** One sentence, grounded in real state/data. Never a fabricated figure. */
  reason: string;
  action: NextActionButton;
  /** At most two, small. Never a wall. */
  watching: WatchItem[];
}

/** Device-split conversion signal, measured from real store_visits + orders. */
export interface DeviceConversion {
  mobileSessions: number;
  mobileOrders: number;
  desktopSessions: number;
  desktopOrders: number;
  /** Share of paid orders whose session's device is known (0–100). */
  coveragePct: number;
}

/** The facts the selector needs — all already computed from real tables. */
export interface NextActionFacts {
  storeCount: number;
  /** Live (published) stores. */
  publishedCount: number;
  /** Whether the plan may publish at all (Free cannot). */
  canPublish: boolean;
  /** Merchant's Stripe payout account is active. */
  paymentsConnected: boolean;
  /** Live stores that currently cannot take a payment. */
  liveWithoutPayments: number;
  /** Where store-scoped actions route; null → home. */
  primaryStoreId: string | null;
  /** Distinct visitors in the last 7 days (across stores). */
  visitors7d: number;
  /** All-time paid/fulfilled orders (across stores). */
  ordersTotal: number;
  /** Balance can't cover a store generation → worth a gentle note. */
  lowCredits: boolean;
  /** Measured device conversion, or null when not computed / no data. */
  device: DeviceConversion | null;
}

/*
 * Gates for the performance lane. These bound WHEN a recommendation may appear;
 * the recommendation TEXT always uses the real measured numbers, never these.
 * Deliberately conservative — trust is the whole point of the feature.
 */
export const NEXT_ACTION_GATES = {
  /** All-time orders before any performance recommendation is considered. */
  minOrdersForPerformance: 20,
  /** Sessions required on EACH device before comparing their conversion. */
  minSessionsPerDevice: 200,
  /** Attribution coverage required to trust a comparison (percent). */
  minCoveragePct: 60,
  /** Mobile must be at least this much worse than desktop (relative) to flag. */
  minRelativeGap: 0.25,
  /** A softer bar for an honest "early signal" note (not a primary claim). */
  earlySignalMinSessionsPerDevice: 40,
} as const;

function storeHref(id: string | null): string {
  return id ? `/dashboard/stores/${id}` : "/dashboard";
}

/** Relative gap by which mobile trails desktop, 0–1, or null if incomputable. */
function mobileShortfall(d: DeviceConversion): { relGap: number; mobileSharePct: number } | null {
  const totalSessions = d.mobileSessions + d.desktopSessions;
  if (d.mobileSessions <= 0 || d.desktopSessions <= 0 || totalSessions <= 0) return null;
  const mConv = d.mobileOrders / d.mobileSessions;
  const dConv = d.desktopOrders / d.desktopSessions;
  if (dConv <= 0 || mConv >= dConv) return null;
  return {
    relGap: 1 - mConv / dConv,
    mobileSharePct: Math.round((d.mobileSessions / totalSessions) * 100),
  };
}

/** Build the ≤2 secondary "worth watching" notes. Order = importance. */
function buildWatching(f: NextActionFacts, primaryKind: NextActionKind): WatchItem[] {
  const items: WatchItem[] = [];

  // A live store turning away money, when that isn't already the primary move.
  if (primaryKind !== "connect_stripe" && f.liveWithoutPayments > 0) {
    const n = f.liveWithoutPayments;
    items.push({
      title: "A live store can't take payments",
      detail: `${n} of your live ${n === 1 ? "stores has" : "stores have"} no active payout account — those visitors can't check out.`,
    });
  }

  // Honest early signal: mobile looks weaker, but the sample is too small to act.
  const d = f.device;
  if (
    d &&
    primaryKind !== "fix_mobile_conversion" &&
    d.mobileSessions >= NEXT_ACTION_GATES.earlySignalMinSessionsPerDevice &&
    d.desktopSessions >= NEXT_ACTION_GATES.earlySignalMinSessionsPerDevice
  ) {
    const short = mobileShortfall(d);
    const belowFullGate =
      d.mobileSessions < NEXT_ACTION_GATES.minSessionsPerDevice ||
      d.desktopSessions < NEXT_ACTION_GATES.minSessionsPerDevice ||
      d.coveragePct < NEXT_ACTION_GATES.minCoveragePct;
    if (short && short.relGap >= NEXT_ACTION_GATES.minRelativeGap && belowFullGate) {
      items.push({
        title: "Early signal",
        detail:
          "Mobile conversion looks weaker than desktop, but there isn't enough traffic yet to call this a reliable pattern.",
      });
    }
  }

  if (f.lowCredits) {
    items.push({
      title: "Credits running low",
      detail: "You're low on credits for heavy actions like generating a store or images.",
    });
  }

  return items.slice(0, 2);
}

/** The one performance recommendation, or null when the gate isn't cleared. */
function performanceAction(f: NextActionFacts): NextAction | null {
  const d = f.device;
  if (!d) return null;
  if (f.ordersTotal < NEXT_ACTION_GATES.minOrdersForPerformance) return null;
  if (
    d.mobileSessions < NEXT_ACTION_GATES.minSessionsPerDevice ||
    d.desktopSessions < NEXT_ACTION_GATES.minSessionsPerDevice ||
    d.coveragePct < NEXT_ACTION_GATES.minCoveragePct
  ) {
    return null;
  }
  const short = mobileShortfall(d);
  if (!short || short.relGap < NEXT_ACTION_GATES.minRelativeGap) return null;

  const relGapPct = Math.round(short.relGap * 100);
  return {
    kind: "fix_mobile_conversion",
    tone: "performance",
    title: "Fix mobile conversion",
    reason: `${short.mobileSharePct}% of your traffic is mobile, and it converts ${relGapPct}% below desktop.`,
    action: { label: "Review store", href: storeHref(f.primaryStoreId) },
    watching: buildWatching(f, "fix_mobile_conversion"),
  };
}

/**
 * Pick the single next move. Activation ladder first (deterministic, always
 * available), then — only when the data truly supports it — one performance
 * recommendation. Falls back to a calm growth message.
 */
export function pickNextAction(f: NextActionFacts): NextAction {
  const withWatching = (a: Omit<NextAction, "watching">): NextAction => ({
    ...a,
    watching: buildWatching(f, a.kind),
  });

  // 1. No store yet.
  if (f.storeCount === 0) {
    return withWatching({
      kind: "create_store",
      tone: "activation",
      title: "Create your first store",
      reason: "Describe your idea and Urivo generates a complete, branded store for you.",
      action: { label: "Create a store", href: "/dashboard" },
    });
  }

  // 2. Has a store, nothing live.
  if (f.publishedCount === 0) {
    if (f.canPublish) {
      return withWatching({
        kind: "publish_store",
        tone: "activation",
        title: "Publish your store",
        reason: "Your store is built — take it live so customers can find and buy from it.",
        action: { label: "Publish store", href: storeHref(f.primaryStoreId) },
      });
    }
    return withWatching({
      kind: "upgrade_to_publish",
      tone: "activation",
      title: "Take your store live",
      reason: "Publishing is part of a paid plan — go live so customers can start buying.",
      action: { label: "See plans", href: "/dashboard/billing" },
    });
  }

  // 3. Live, but can't take money.
  if (!f.paymentsConnected || f.liveWithoutPayments > 0) {
    return withWatching({
      kind: "connect_stripe",
      tone: "activation",
      title: "Connect Stripe to get paid",
      reason: "Your store is live, but customers can't pay yet — connect payouts to start selling.",
      action: { label: "Connect Stripe", href: "/dashboard/billing" },
    });
  }

  // 4. Ready to sell, no traffic yet.
  if (f.ordersTotal === 0 && f.visitors7d === 0) {
    return withWatching({
      kind: "first_visitor",
      tone: "activation",
      title: "Get your first visitor",
      reason: "Your store is live and can take payments — now bring people to it.",
      action: { label: "Open Marketing", href: "/dashboard/ads" },
    });
  }

  // 5. Traffic but no sales.
  if (f.ordersTotal === 0) {
    return withWatching({
      kind: "convert_traffic",
      tone: "activation",
      title: "Turn visits into sales",
      reason: "You're getting visitors but no orders yet — review your store and keep driving traffic.",
      action: { label: "Review your store", href: storeHref(f.primaryStoreId) },
    });
  }

  // 6. Selling — one gated performance recommendation, if the data supports it.
  const perf = performanceAction(f);
  if (perf) return perf;

  // 7. Selling, nothing to flag → keep the momentum.
  return withWatching({
    kind: "keep_growing",
    tone: "growth",
    title: "Nothing needs you right now",
    reason: "Your store is selling and running cleanly — keep driving quality traffic.",
    action: { label: "Open Marketing", href: "/dashboard/ads" },
  });
}
