import { describe, it, expect } from "vitest";
import { entitledPlanKey, type EntitlementInput } from "@/lib/plans";

/*
 * PAUSE is derived, so its correctness is: does the definer SQL rule in
 * migration 0058 (store_is_paused) agree with the TypeScript entitlement source
 * of truth (entitledPlanKey + canPublish)? Two encodings of one rule that must
 * never drift.
 *
 * The SQL predicate is:
 *   is_active AND NOT ( plan in ('core','pro')
 *                       AND ( subscription_status in ('active','past_due')
 *                             OR comped_until > now() ) )
 *
 * That inner clause is exactly "the owner resolves to a paid tier", i.e.
 * entitledPlanKey(profile) !== "free". So paused ⇔ is_active AND the owner has
 * lapsed to free entitlement. This is deliberately keyed on ENTITLEMENT, not on
 * canPublish() — whether the free tier may publish is a separate, movable
 * policy, whereas "lapsed to free" is the stable definition of a paused store.
 * The tests below (a) pin the spec's transitions and (b) prove the SQL mirror
 * and the TS entitlement give the same verdict across a full matrix.
 */

type Profile = EntitlementInput;

const NOW = new Date("2026-09-01T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const PAST = new Date(NOW.getTime() - 86_400_000).toISOString();

/** Faithful re-implementation of the migration 0058 SQL predicate. */
function sqlPaused(profile: Profile, isActive: boolean, now: Date): boolean {
  if (!isActive) return false;
  const plan = profile.plan ?? "";
  const status = profile.subscription_status ?? "";
  const comp = profile.comped_until ? new Date(profile.comped_until).getTime() : NaN;
  const entitled =
    (plan === "core" || plan === "pro") &&
    (status === "active" || status === "past_due" || (Number.isFinite(comp) && comp > now.getTime()));
  return !entitled;
}

/** The TypeScript source of truth: published + the owner has lapsed to free. */
function tsPaused(profile: Profile, isActive: boolean, now: Date): boolean {
  return isActive && entitledPlanKey(profile, now) === "free";
}

describe("store_is_paused — the transitions from the spec", () => {
  const cases: { name: string; profile: Profile; isActive: boolean; paused: boolean }[] = [
    { name: "paid + active, live → NOT paused", profile: { plan: "core", subscription_status: "active" }, isActive: true, paused: false },
    { name: "past_due (dunning) stays live → NOT paused", profile: { plan: "core", subscription_status: "past_due" }, isActive: true, paused: false },
    { name: "cancelled → paused", profile: { plan: "core", subscription_status: "cancelled" }, isActive: true, paused: true },
    { name: "expired/none → paused", profile: { plan: "pro", subscription_status: "none" }, isActive: true, paused: true },
    { name: "valid comp → NOT paused", profile: { plan: "pro", subscription_status: "none", comped_until: FUTURE }, isActive: true, paused: false },
    { name: "expired comp → paused", profile: { plan: "pro", subscription_status: "none", comped_until: PAST }, isActive: true, paused: true },
    { name: "free with a live store → paused", profile: { plan: "free", subscription_status: "active" }, isActive: true, paused: true },
    { name: "draft is not 'paused'", profile: { plan: "core", subscription_status: "cancelled" }, isActive: false, paused: false },
    { name: "reactivated → back to live", profile: { plan: "pro", subscription_status: "active" }, isActive: true, paused: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(sqlPaused(c.profile, c.isActive, NOW)).toBe(c.paused);
      expect(tsPaused(c.profile, c.isActive, NOW)).toBe(c.paused);
    });
  }
});

describe("store_is_paused — SQL rule and TS entitlement never drift", () => {
  it("agree on every combination of plan / status / comp / is_active", () => {
    const plans = ["free", "core", "pro", "enterprise", "", null];
    const statuses = ["active", "past_due", "cancelled", "none", "", null];
    const comps = [undefined, FUTURE, PAST];
    const actives = [true, false];

    for (const plan of plans)
      for (const subscription_status of statuses)
        for (const comped_until of comps)
          for (const isActive of actives) {
            const profile: Profile = { plan, subscription_status, comped_until };
            expect(sqlPaused(profile, isActive, NOW), JSON.stringify({ profile, isActive })).toBe(
              tsPaused(profile, isActive, NOW),
            );
          }
  });
});
