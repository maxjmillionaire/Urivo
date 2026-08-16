import { describe, it, expect } from "vitest";
import { entitledPlanKey, entitledPlan } from "./plans";

/*
 * ENTITLEMENT — the rule that decides whether a paid tier may actually be used.
 *
 * The bug these tests exist to prevent: the product read `profiles.plan` and
 * stopped there. Stripe writes a subscription the moment the Checkout form is
 * completed, and a card that fails authentication leaves it `incomplete` — a
 * real row, naming a real tier, with no money behind it. Every gate in the
 * product read that column, so completing checkout with a declining card was
 * enough to hold Founder.
 *
 * Each case below is a state Stripe can genuinely put an account in.
 */

const HOUR = 3_600_000;
const now = new Date("2026-08-08T12:00:00Z");
const future = new Date(now.getTime() + 48 * HOUR).toISOString();
const past = new Date(now.getTime() - HOUR).toISOString();

describe("entitledPlanKey — paid access follows payment, not the plan column", () => {
  it("grants the tier when Stripe says the subscription is active", () => {
    expect(entitledPlanKey({ plan: "core", subscription_status: "active" }, now)).toBe("core");
    expect(entitledPlanKey({ plan: "pro", subscription_status: "active" }, now)).toBe("pro");
  });

  it("REFUSES a plan left behind by an incomplete checkout", () => {
    // The hole: checkout.session.completed fires, the card never authenticates,
    // the subscription sits at `incomplete` → status "none".
    expect(entitledPlanKey({ plan: "core", subscription_status: "none" }, now)).toBe("free");
    expect(entitledPlanKey({ plan: "pro", subscription_status: "none" }, now)).toBe("free");
  });

  it("REFUSES a cancelled subscription", () => {
    expect(entitledPlanKey({ plan: "pro", subscription_status: "cancelled" }, now)).toBe("free");
  });

  it("keeps access while a card is being retried (past_due is dunning, not theft)", () => {
    // Deliberate: the subscription still exists and Stripe is retrying. Cutting
    // a merchant's storefront off on the first blip is hostile, and dunning is
    // the window in which they are most likely to pay.
    expect(entitledPlanKey({ plan: "core", subscription_status: "past_due" }, now)).toBe("core");
  });

  it("honours an unexpired comp with no subscription at all", () => {
    expect(
      entitledPlanKey({ plan: "pro", subscription_status: "none", comped_until: future }, now),
    ).toBe("pro");
  });

  it("drops an expired comp immediately, without waiting for the sweep", () => {
    expect(
      entitledPlanKey({ plan: "pro", subscription_status: "none", comped_until: past }, now),
    ).toBe("free");
  });

  it("treats a missing profile, missing status and junk plan as Free", () => {
    expect(entitledPlanKey(null, now)).toBe("free");
    expect(entitledPlanKey(undefined, now)).toBe("free");
    expect(entitledPlanKey({ plan: "core" }, now)).toBe("free");
    expect(entitledPlanKey({ plan: "enterprise", subscription_status: "active" }, now)).toBe("free");
    expect(entitledPlanKey({ plan: "pro", comped_until: "not-a-date" }, now)).toBe("free");
  });

  it("never downgrades Free below Free, whatever the status says", () => {
    expect(entitledPlanKey({ plan: "free", subscription_status: "cancelled" }, now)).toBe("free");
    expect(entitledPlanKey({ plan: "free", subscription_status: "active" }, now)).toBe("free");
  });

  it("cannot be talked into a tier by a client-supplied field", () => {
    // Whatever else arrives on the object, only the three real columns count.
    const hostile = {
      plan: "free",
      subscription_status: "none",
      isPro: true,
      entitled: "pro",
      features: { publish: true, evolution: "advanced" },
    } as never;
    expect(entitledPlanKey(hostile, now)).toBe("free");
  });
});

describe("entitledPlan — the features an unpaid tier actually gets", () => {
  it("hands an incomplete-checkout account the Free feature set", () => {
    const plan = entitledPlan({ plan: "pro", subscription_status: "none" }, now);
    expect(plan.key).toBe("free");
    // The tier boundaries that cost money: capacity and the Evolution Lab.
    expect(plan.maxLiveStores).toBe(1);
    expect(plan.features.evolution).toBe("none");
    expect(plan.monthlyCredits).toBe(0);
  });

  it("hands a genuinely paid Pro account the Pro feature set", () => {
    const plan = entitledPlan({ plan: "pro", subscription_status: "active" }, now);
    expect(plan.key).toBe("pro");
    expect(plan.maxLiveStores).toBeNull();
    expect(plan.features.evolution).toBe("advanced");
  });
});
