/*
 * Plans — the single source of truth for Urivo's subscription tiers.
 *
 * Internal database keys stay `free` / `core` / `pro` (stable, never migrated);
 * the customer-facing names are Free / Founder / Pro. Everything that treats a
 * tier differently — credits, generation priority, feature access, pricing — is
 * defined HERE and read everywhere else, so marketing (the pricing deck) and the
 * product can never drift apart.
 *
 * This module is isomorphic (no server-only imports) so client surfaces — the
 * billing page, the account menu — can render names and prices from it directly.
 */

export type PlanKey = "free" | "core" | "pro";
export type Priority = "standard" | "priority" | "highest";
export type EvolutionTier = "none" | "standard" | "advanced";

export interface PlanConfig {
  key: PlanKey;
  /** Customer-facing name. */
  name: string;
  tagline: string;
  /** Credits granted at the start of each paid billing period (0 for Free). */
  monthlyCredits: number;
  /** One-time credits granted at signup (Free tier taste; 0 for paid — they get monthlyCredits). */
  signupCredits: number;
  priority: Priority;
  /** Priority made concrete: how many generations / assistant messages per minute. */
  generationsPerMinute: number;
  askPerMinute: number;
  /**
   * How many stores may be LIVE at once. null = unlimited.
   *
   * Capacity is the product's natural unit — Urivo makes stores, so "how many
   * can you run" is what a tier sells. Framed to the merchant as capacity
   * ("run up to 3 live stores"), never as a restriction: the same fact, and a
   * measurably different response to it.
   */
  maxLiveStores: number | null;
  /**
   * Paid orders a month this tier carries. null = uncapped (Pro).
   *
   * This is a TIER BOUNDARY, not a take rate and not a hard limit. Urivo takes
   * no percentage of a merchant's sales — a percentage would tax exactly the
   * merchants who succeed and grow forever, and give the best of them a
   * standing reason to leave. A tier is capped: at €5k a month Founder is 4% of
   * revenue, at €50k it is 0.4%. Success gets cheaper.
   *
   * Crossing it never blocks a sale. Nothing on the checkout path reads it.
   */
  maxMonthlyOrders: number | null;
  features: {
    /** Take a generated store live (publish to its subdomain). */
    publish: boolean;
    /** The AI Store Assistant (Ask Urivo). */
    askUrivo: boolean;
    /** Evolution Lab access + depth. */
    evolution: EvolutionTier;
    premiumSupport: boolean;
    earlyAccess: boolean;
  };
  price: {
    currency: "EUR";
    /** Monthly price during the launch window. */
    launch: number;
    /** Monthly price after the launch window. */
    regular: number;
    /** Lifetime price for founding members (first 50). Undefined = no discount. */
    founding?: number;
    /**
     * Annual price — the year paid up front. Set to ten months of the monthly
     * price: two months free is the discount customers recognise instantly and
     * can verify in their head, which matters more than squeezing the ratio.
     */
    annual: number;
  };
  /** Marketing bullets — kept here so the pricing deck and product never drift. */
  highlights: string[];
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  free: {
    key: "free",
    name: "Free",
    tagline: "Generate your first store and take it live.",
    monthlyCredits: 0,
    // 20 buys the store, the rest buys a taste of the assistant that sells Pro.
    signupCredits: 25,
    priority: "standard",
    generationsPerMinute: 3,
    askPerMinute: 5,
    /*
     * Zero, and it is load-bearing.
     *
     * `publish_store` refuses when `live_count >= p_max_live`, so a capacity of
     * 0 means the first publish is already at the cap. Combined with
     * `features.publish: false` below, a Free merchant is refused twice: once by
     * the route before the call, once by the database inside it. Either alone
     * would do; both is deliberate, because this is the line between the free
     * tier and revenue.
     */
    maxLiveStores: 0,
    maxMonthlyOrders: 25,
    features: {
      /*
       * Free builds, previews and refines. It does not go live.
       *
       * This reverses the original decision, which was argued in this file as
       * "a free user must reach 'my store is LIVE' — people do not pay to keep
       * something they have never had". That reasoning is not wrong about human
       * beings; it was overruled as a business decision, and the reversal is
       * recorded here rather than silently applied so the next person reads an
       * argument and its outcome instead of a bare `false`.
       *
       * Enforced in four places, because a paywall that exists in one is not a
       * paywall: this flag (checked by the store settings route and the Ask
       * Urivo apply route), the capacity above (checked inside publish_store),
       * and `generate_store_atomic`, which no longer creates a live store for a
       * merchant who may not have one — see migration 0055. A generated store
       * used to be born with is_active defaulting to true, which meant Free
       * never needed the publish path at all.
       */
      publish: false,
      askUrivo: true,
      evolution: "none",
      premiumSupport: false,
      earlyAccess: false,
    },
    price: { currency: "EUR", launch: 0, regular: 0, annual: 0 },
    highlights: [
      "25 welcome AI credits",
      "Build and preview a full store",
      "A taste of the AI Store Assistant",
    ],
  },
  core: {
    key: "core",
    name: "Founder",
    tagline: "Monthly credits, the AI Store Assistant, and stores you can publish.",
    monthlyCredits: 150,
    signupCredits: 0,
    priority: "priority",
    generationsPerMinute: 8,
    askPerMinute: 20,
    maxLiveStores: 3,
    maxMonthlyOrders: 100,
    features: {
      publish: true,
      askUrivo: true,
      evolution: "standard",
      premiumSupport: false,
      earlyAccess: false,
    },
    price: { currency: "EUR", launch: 49, regular: 49, founding: 29, annual: 490 },
    highlights: [
      "150 AI credits every month",
      "Run up to 3 live stores",
      "AI Store Assistant",
      "Evolution Lab",
      "Publish your stores",
      "Priority AI generation",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    tagline: "Built to run a portfolio — five times the credits, highest priority, Advanced Evolution.",
    monthlyCredits: 800,
    signupCredits: 0,
    priority: "highest",
    generationsPerMinute: 15,
    askPerMinute: 40,
    maxLiveStores: null,
    maxMonthlyOrders: null,
    features: {
      publish: true,
      askUrivo: true,
      evolution: "advanced",
      premiumSupport: true,
      earlyAccess: true,
    },
    price: { currency: "EUR", launch: 199, regular: 199, founding: 149, annual: 1990 },
    highlights: [
      "800 AI credits every month",
      "Unlimited live stores",
      "Advanced Evolution Lab",
      "Highest AI generation priority",
      "Premium support",
      "Early access to new features",
    ],
  },
};

/** Normalize any stored/unknown plan string to a real config (defaults to Free). */
export function getPlan(key: string | null | undefined): PlanConfig {
  if (key === "core" || key === "pro" || key === "free") return PLANS[key];
  return PLANS.free;
}

/*
 * ENTITLEMENT — what a tier is allowed to do is decided HERE, from authoritative
 * payment state, never from the plan column alone.
 *
 * `profiles.plan` records which tier a subscription is FOR. It does not, on its
 * own, mean the tier was paid for: Stripe writes a subscription the moment
 * Checkout completes, and a card that fails authentication leaves that
 * subscription `incomplete` — real row, real plan, no money. Reading `plan` and
 * stopping there hands out Founder to anyone who reaches the Checkout form with
 * a card that declines.
 *
 * A paid tier is therefore entitled only when one of two things is true:
 *
 *   ACTIVE — Stripe says the subscription is live. `past_due` counts: the
 *   subscription still exists and Stripe is retrying the card. Revoking a
 *   merchant's storefront the hour a renewal blips is hostile, and dunning is
 *   exactly the window in which they might pay. Stripe cancels for real when
 *   retries run out, which arrives as subscription.deleted and drops to Free.
 *
 *   COMPED — access was granted rather than bought (migration 0035), and the
 *   grant has not expired yet. Reading the expiry here means a comp ends the
 *   moment it says it does, instead of whenever the opportunistic sweep runs.
 *
 * Anything else — `none` (incomplete checkout), `cancelled`, an expired comp —
 * is Free, whatever the plan column happens to say.
 */
export type EntitlementInput = {
  plan: string | null | undefined;
  subscription_status?: string | null;
  comped_until?: string | Date | null;
};

export function entitledPlanKey(profile: EntitlementInput | null | undefined, now: Date = new Date()): PlanKey {
  const key = getPlan(profile?.plan).key;
  if (key === "free") return "free";

  const status = profile?.subscription_status;
  if (status === "active" || status === "past_due") return key;

  const comped = profile?.comped_until;
  if (comped) {
    const until = comped instanceof Date ? comped : new Date(comped);
    if (!Number.isNaN(until.getTime()) && until > now) return key;
  }

  return "free";
}

/** The plan a profile may actually USE — the entitlement rule above, as a config. */
export function entitledPlan(profile: EntitlementInput | null | undefined, now: Date = new Date()): PlanConfig {
  return getPlan(entitledPlanKey(profile, now));
}

/** Launch pricing window — founder pricing is live between these dates. */
const LAUNCH_START = new Date("2026-07-23T00:00:00Z");
const LAUNCH_END = new Date("2026-08-15T23:59:59Z");

export function isLaunchWindow(now: Date = new Date()): boolean {
  return now >= LAUNCH_START && now <= LAUNCH_END;
}

/** The effective monthly price for a plan right now (launch or regular). */
export function monthlyPrice(key: string | null | undefined, now: Date = new Date()): number {
  const p = getPlan(key);
  return isLaunchWindow(now) ? p.price.launch : p.price.regular;
}

/**
 * The price a specific user pays for a plan. Founding members (first 50) keep a
 * lifetime discounted price; everyone else pays the standard monthly price.
 */
export function priceForUser(
  key: string | null | undefined,
  priceType: string | null | undefined,
  now: Date = new Date(),
): number {
  const p = getPlan(key);
  if (priceType === "founding" && typeof p.price.founding === "number") {
    return p.price.founding;
  }
  return monthlyPrice(key, now);
}

/** True if this price tag is a real, honour-forever founding member. */
export function isFounding(priceType: string | null | undefined): boolean {
  return priceType === "founding";
}

export function planName(key: string | null | undefined): string {
  return getPlan(key).name;
}

/** The next tier up from a plan (free→Founder, core→Pro), or null at the top. */
export function nextPlan(key: string | null | undefined): PlanConfig | null {
  const k = getPlan(key).key;
  if (k === "free") return PLANS.core;
  if (k === "core") return PLANS.pro;
  return null;
}

export function isPaid(key: string | null | undefined): boolean {
  return getPlan(key).key !== "free";
}

export function canPublish(key: string | null | undefined): boolean {
  return getPlan(key).features.publish;
}

export function canAskUrivo(key: string | null | undefined): boolean {
  return getPlan(key).features.askUrivo;
}

export function evolutionTier(key: string | null | undefined): EvolutionTier {
  return getPlan(key).features.evolution;
}

/** Format a EUR price for display (whole euros, no cents). */
export function formatPrice(euros: number): string {
  // Annual prices are four digits, and "€1990" reads as a typo where "€1,990"
  // reads as a price. Grouped with a thin space rather than a comma or a dot,
  // which are the decimal mark in half of Urivo's markets.
  if (euros === 0) return "€0";
  return `€${Math.round(euros).toLocaleString("en-US").replace(/,/g, "\u202f")}`;
}

/** Live-store capacity for a plan. null = unlimited (Pro). */
export function maxLiveStores(key: string | null | undefined): number | null {
  return getPlan(key).maxLiveStores;
}

/** Capacity as the merchant should read it — capacity, never restriction. */
export function capacityLabel(key: string | null | undefined): string {
  const max = maxLiveStores(key);
  if (max === null) return "Unlimited live stores";
  /*
   * Zero capacity is not "run up to 0 live stores". A tier that cannot publish
   * has a capability to describe, not a number — and the house rule for this
   * label holds: say what the merchant gets, never what they are denied.
   */
  if (max === 0) return `Build and preview — publishing starts on ${PLANS.core.name}`;
  return `Run up to ${max} live store${max === 1 ? "" : "s"}`;
}

export type BillingInterval = "month" | "year";

/**
 * What a plan costs for the chosen interval. Annual is a flat published price
 * rather than a discount applied to whatever the monthly happens to be — the
 * founding rate is a MONTHLY lifetime lock and does not stack with paying a
 * year up front, and quietly compounding the two would give away the tier.
 */
export function priceForInterval(
  key: string | null | undefined,
  interval: BillingInterval,
  priceType: string | null | undefined = null,
  now: Date = new Date(),
): number {
  const plan = getPlan(key);
  return interval === "year" ? plan.price.annual : priceForUser(plan.key, priceType, now);
}

/** Months of the monthly price a year costs — "two months free", verifiable. */
export function annualMonthsFree(key: string | null | undefined): number {
  const plan = getPlan(key);
  if (plan.price.regular <= 0 || plan.price.annual <= 0) return 0;
  return Math.round(12 - plan.price.annual / plan.price.regular);
}

/** What the customer keeps by paying yearly, in euros. */
export function annualSavingEur(key: string | null | undefined): number {
  const plan = getPlan(key);
  if (plan.price.regular <= 0 || plan.price.annual <= 0) return 0;
  return plan.price.regular * 12 - plan.price.annual;
}

/** Paid orders a month this tier carries. null = uncapped. */
export function maxMonthlyOrders(key: string | null | undefined): number | null {
  return getPlan(key).maxMonthlyOrders;
}

export type VolumeStanding = "fine" | "approaching" | "over";

/**
 * Where a merchant sits against their tier's volume.
 *
 * "approaching" starts at 80% so the upgrade is a decision they make with a
 * week's warning, never a surprise. Success is the moment to ask — and the
 * worst moment to interrupt.
 */
export function volumeStanding(key: string | null | undefined, ordersThisMonth: number): VolumeStanding {
  const max = maxMonthlyOrders(key);
  if (max === null) return "fine";
  if (ordersThisMonth >= max) return "over";
  return ordersThisMonth >= Math.floor(max * 0.8) ? "approaching" : "fine";
}

/** What the merchant reads. Congratulates the volume; never scolds it. */
export function volumeMessage(
  key: string | null | undefined,
  ordersThisMonth: number,
): { title: string; detail: string } | null {
  const standing = volumeStanding(key, ordersThisMonth);
  if (standing === "fine") return null;
  const max = maxMonthlyOrders(key) ?? 0;
  const next = nextPlan(key);
  const nextLine = next
    ? `${next.name} carries ${next.maxMonthlyOrders === null ? "unlimited orders" : `${next.maxMonthlyOrders} a month`}.`
    : "";

  return standing === "over"
    ? {
        title: `${ordersThisMonth} orders this month — you've outgrown ${getPlan(key).name}`,
        detail: `Nothing stops: your stores keep selling and every order still reaches you. ${nextLine}`.trim(),
      }
    : {
        title: `${ordersThisMonth} of ${max} orders this month`,
        detail: `You're close to what ${getPlan(key).name} carries. ${nextLine}`.trim(),
      };
}
