/*
 * Pricing & currency architecture.
 *
 * DECISION (CEO): EUR is the internal ACCOUNTING currency for now. But the
 * system is architected so multi-currency checkout can be added later WITHOUT a
 * database migration and WITHOUT rewriting pricing logic.
 *
 * How that guarantee holds:
 *   1. Accounting is always EUR. Every monetary amount persisted for reporting
 *      (credit_ledger, referrals.*_eur, the finance ledger's USD→EUR view) is
 *      the EUR-normalised value. Because the accounting currency never changes,
 *      existing tables never need a currency column added.
 *   2. Presentation/checkout currency is a separate concern. This module is the
 *      one place that knows about display currencies; today it supports EUR
 *      only. Adding USD/GBP/… is: widen the `Currency` union, add FX rows, list
 *      them in SUPPORTED_CHECKOUT_CURRENCIES. No call site changes shape.
 *   3. Stripe (Phase 2) handles localized checkout currencies natively; its
 *      payment records carry the presentment currency. When we persist those,
 *      we store BOTH the presentment amount/currency AND the EUR-normalised
 *      accounting amount — the referrals table already has nullable presentment
 *      columns (migration 0013) for exactly this, so no future migration.
 *
 * Isomorphic (no server-only imports): the checkout UI, the pricing page and
 * the server all compute prices the same way.
 */

import { getPlan, isLaunchWindow, type PlanKey } from "@/lib/plans";

// Widen this union to add currencies. Everything below is keyed off it, so the
// compiler flags every place that must gain a value when a currency is added.
export type Currency = "EUR";

export const ACCOUNTING_CURRENCY: Currency = "EUR";

/** Currencies offered at checkout today. Phase 2 grows this (e.g. USD, GBP). */
export const SUPPORTED_CHECKOUT_CURRENCIES: readonly Currency[] = ["EUR"];

/**
 * FX table: units of each currency per 1 EUR. EUR is the pivot (accounting
 * currency), so its rate is exactly 1. Phase 2 replaces the static values with
 * live rates (or Stripe's presentment rates) — the shape stays identical.
 */
const UNITS_PER_EUR: Record<Currency, number> = {
  EUR: 1,
};

/** Locale + minor-unit config per currency, for correct formatting/rounding. */
const CURRENCY_META: Record<Currency, { locale: string; fractionDigits: number }> = {
  EUR: { locale: "de-DE", fractionDigits: 2 },
};

export interface Money {
  amount: number;
  currency: Currency;
}

export function money(amount: number, currency: Currency = ACCOUNTING_CURRENCY): Money {
  return { amount, currency };
}

function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Convert a Money to another currency via the EUR pivot. */
export function convert(m: Money, to: Currency): Money {
  // No early same-currency return: with a single supported currency it would
  // narrow `to` to `never`. The maths below is a no-op for same-currency and
  // correct once more currencies (and FX rows) are added.
  const inEur = m.amount / UNITS_PER_EUR[m.currency];
  const converted = inEur * UNITS_PER_EUR[to];
  return { amount: roundTo(converted, CURRENCY_META[to].fractionDigits), currency: to };
}

/** Normalise any Money to the accounting currency (EUR) — what gets persisted. */
export function toAccounting(m: Money): Money {
  return convert(m, ACCOUNTING_CURRENCY);
}

export type PriceWindow = "auto" | "launch" | "regular";

/**
 * A plan's price as Money in the requested checkout currency. Defaults to EUR
 * and the live window (launch vs regular). Adding currencies later needs no
 * change here — `convert` handles the FX off the EUR source of truth in
 * lib/plans.
 */
export function planPriceMoney(
  planKey: PlanKey | string | null | undefined,
  opts: { window?: PriceWindow; currency?: Currency; now?: Date } = {},
): Money {
  const { window = "auto", currency = ACCOUNTING_CURRENCY, now = new Date() } = opts;
  const plan = getPlan(planKey);
  const useLaunch = window === "launch" || (window === "auto" && isLaunchWindow(now));
  const eur = useLaunch ? plan.price.launch : plan.price.regular;
  return convert(money(eur, "EUR"), currency);
}

/** Format Money for display with the correct locale + symbol. */
export function formatMoney(m: Money): string {
  const meta = CURRENCY_META[m.currency];
  return new Intl.NumberFormat(meta.locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: m.amount % 1 === 0 ? 0 : meta.fractionDigits,
  }).format(m.amount);
}
