"use client";

import { useState } from "react";
import { UpgradeButton } from "./upgrade-buttons";
import {
  PLANS,
  formatPrice,
  priceForUser,
  annualMonthsFree,
  annualSavingEur,
  type PlanKey,
} from "@/lib/plans";

/*
 * Plan chooser with a monthly/annual toggle.
 *
 * Annual exists for three reasons that all point the same way: a year of cash
 * on the day someone subscribes, twelve months of churn removed, and a
 * materially higher LTV. For the merchant it is simply two months free.
 *
 * Monthly is the default because it is the lower-commitment choice and this
 * audience is buying on trust. Annual is presented beside it with the saving
 * stated in euros rather than a percentage — "save €98" is checkable in a way
 * "save 17%" is not, and a number a customer can verify is a number they
 * believe.
 */

type Interval = "month" | "year";

export function PlanPicker({
  priceType,
  isFoundingMember,
  launch,
  currentPlan = "free",
}: {
  priceType: string | null;
  isFoundingMember: boolean;
  launch: boolean;
  currentPlan?: string;
}) {
  const [interval, setInterval] = useState<Interval>("month");
  const annual = interval === "year";

  return (
    <>
      <div className="mt-4 flex items-center justify-center">
        <div
          role="tablist"
          aria-label="Billing interval"
          className="inline-flex rounded-xl border border-hair bg-night p-1"
        >
          {(["month", "year"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={interval === v}
              onClick={() => setInterval(v)}
              className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                interval === v ? "u-gold" : "text-mist hover:text-ivory"
              }`}
            >
              {v === "month" ? "Monthly" : "Yearly"}
              {v === "year" && (
                <span className={`ml-1.5 text-[11px] ${interval === v ? "opacity-75" : "text-gold-soft"}`}>
                  −{annualMonthsFree("core")} months
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {annual && isFoundingMember && (
        /* Said plainly rather than discovered at checkout. The founding rate is
           a monthly lifetime lock; paying yearly is a different, flat price. */
        <p className="mt-3 text-center text-xs text-mist">
          Your founding price is a monthly lifetime rate — yearly is billed at the standard annual price.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {([PLANS.core, PLANS.pro] as const).map((p) => {
          const isCurrent = p.key === currentPlan;
          // Emphasise the tier they can actually move TO, not the one they hold.
          const popular = currentPlan === "core" ? p.key === "pro" : p.key === "core";
          const monthly = priceForUser(p.key as PlanKey, priceType);
          const price = annual ? p.price.annual : monthly;
          const struck = annual
            ? p.price.regular * 12
            : isFoundingMember || launch
              ? p.price.regular
              : null;
          const saving = annualSavingEur(p.key);

          return (
            <div
              key={p.key}
              className={`u-float relative flex flex-col rounded-2xl bg-panel/70 p-6 ${
                popular ? "border border-gold/30" : "border border-hair"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-ivory">{p.name}</h3>
                {isCurrent ? (
                  <span className="rounded-full border border-hair px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-mist">
                    Your plan
                  </span>
                ) : popular ? (
                  <span className="u-gold rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">
                    {currentPlan === "core" ? "Recommended" : "Most popular"}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-ivory">{formatPrice(price)}</span>
                {struck != null && struck !== price && (
                  <span className="text-mist line-through">{formatPrice(struck)}</span>
                )}
                <span className="text-sm text-mist">{annual ? "/ year" : "/ mo"}</span>
              </div>
              {annual ? (
                <p className="mt-1.5 text-[13px] text-gold-soft">
                  {formatPrice(Math.round(p.price.annual / 12))} a month · you keep {formatPrice(saving)}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-mist">
                  or {formatPrice(p.price.annual)} a year — {annualMonthsFree(p.key)} months free
                </p>
              )}

              <ul className="mt-5 flex-1 space-y-2.5">
                {p.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-sm text-mist">
                    <span className="mt-0.5 text-gold-soft">✓</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <p className="rounded-xl border border-hair bg-panel px-6 py-3 text-center text-sm text-mist">
                    You&apos;re on this plan
                  </p>
                ) : (
                <UpgradeButton
                  plan={p.key as "core" | "pro"}
                  label={`Choose ${p.name}`}
                  highlight={popular}
                  interval={interval}
                />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
