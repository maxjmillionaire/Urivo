/*
 * Plans — the single source of truth for Urivo's subscription tiers.
 *
 * Internal database keys stay `free` / `core` / `pro` (stable, never migrated);
 * the customer-facing names are Free / Founder / Elite. Everything that treats a
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
  };
  /** Marketing bullets — kept here so the pricing deck and product never drift. */
  highlights: string[];
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  free: {
    key: "free",
    name: "Free",
    tagline: "Explore Urivo and generate your first store.",
    monthlyCredits: 0,
    signupCredits: 15,
    priority: "standard",
    generationsPerMinute: 3,
    askPerMinute: 0,
    features: {
      publish: false,
      askUrivo: false,
      evolution: "none",
      premiumSupport: false,
      earlyAccess: false,
    },
    price: { currency: "EUR", launch: 0, regular: 0 },
    highlights: ["15 welcome AI credits", "Generate your first store", "Explore the platform"],
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
    features: {
      publish: true,
      askUrivo: true,
      evolution: "standard",
      premiumSupport: false,
      earlyAccess: false,
    },
    price: { currency: "EUR", launch: 49, regular: 79 },
    highlights: [
      "150 AI credits every month",
      "AI Store Assistant",
      "Evolution Lab",
      "Publish your stores",
      "Priority AI generation",
    ],
  },
  pro: {
    key: "pro",
    name: "Elite",
    tagline: "The most credits, highest generation priority, and Advanced Evolution.",
    monthlyCredits: 500,
    signupCredits: 0,
    priority: "highest",
    generationsPerMinute: 15,
    askPerMinute: 40,
    features: {
      publish: true,
      askUrivo: true,
      evolution: "advanced",
      premiumSupport: true,
      earlyAccess: true,
    },
    price: { currency: "EUR", launch: 199, regular: 299 },
    highlights: [
      "500 AI credits every month",
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

export function planName(key: string | null | undefined): string {
  return getPlan(key).name;
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
  return euros === 0 ? "€0" : `€${euros}`;
}
