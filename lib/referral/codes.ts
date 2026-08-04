/*
 * Creator referral rules — the isomorphic core (no server-only imports) so both
 * the checkout UI and the server compute the same discount.
 *
 * Business rules (final, CEO):
 *   • Commission: 25% of the customer's FIRST successful payment, once. Never
 *     recurring.
 *   • Discount: NONE during the launch offer (the customer already has the
 *     launch price — the code is attribution/commission only); 10% off the
 *     first purchase AFTER the launch offer ends.
 */

import { isLaunchWindow } from "@/lib/plans";

export const CREATOR_COMMISSION_RATE = 0.25; // 25% of first payment
export const CREATOR_DISCOUNT_RATE = 0.1; // 10% off first purchase, post-launch

/** Canonical form of a code as stored and compared: trimmed, uppercase. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** A code is well-formed if it's 3–24 chars of A–Z / 0–9 after normalising. */
export function isValidCodeFormat(raw: string): boolean {
  return /^[A-Z0-9]{3,24}$/.test(normalizeCode(raw));
}

/**
 * The customer discount a valid code grants right now.
 *   launch window → 0 (already has the launch price)
 *   after launch  → 0.10 on the first purchase
 */
export function codeDiscountRate(now: Date = new Date()): number {
  return isLaunchWindow(now) ? 0 : CREATOR_DISCOUNT_RATE;
}

/**
 * Commission (EUR) a creator earns on a given first-payment amount.
 *
 * Floored at zero: referrals.commission_amount_eur carries a `>= 0` check, so a
 * negative amount arriving from a refund or an adjustment would raise a
 * constraint violation and break the referral path rather than record nothing.
 * A negative payment simply earns no commission.
 */
export function commissionFor(firstPaymentEur: number, rate = CREATOR_COMMISSION_RATE): number {
  const gross = Math.max(0, firstPaymentEur) * Math.max(0, rate);
  return Math.round(gross * 100) / 100;
}

/**
 * Apply a discount rate to a gross price, returning the net the customer pays.
 * The rate is clamped to 0–1 so a bad rate can never invert the price and hand
 * money back to the customer.
 */
export function applyDiscount(priceEur: number, discountRate: number): number {
  const rate = Math.min(1, Math.max(0, discountRate));
  return Math.round(Math.max(0, priceEur) * (1 - rate) * 100) / 100;
}
