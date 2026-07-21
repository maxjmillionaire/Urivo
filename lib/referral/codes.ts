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

/** Commission (EUR) a creator earns on a given first-payment amount. */
export function commissionFor(firstPaymentEur: number, rate = CREATOR_COMMISSION_RATE): number {
  return Math.round(firstPaymentEur * rate * 100) / 100;
}

/** Apply a discount rate to a gross price, returning the net the customer pays. */
export function applyDiscount(priceEur: number, discountRate: number): number {
  return Math.round(priceEur * (1 - discountRate) * 100) / 100;
}
