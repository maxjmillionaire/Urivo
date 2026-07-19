/*
 * Shared commerce types (client + server). The client cart stores only product
 * ids and quantities — never prices. Every price and total is recomputed
 * server-side at checkout from the database, so a tampered client can never
 * change what is charged.
 */

/** What the browser persists in localStorage. */
export interface CartItem {
  productId: string;
  quantity: number;
}

/** A server-validated line — prices in integer minor units (cents). */
export interface ValidatedLine {
  productId: string;
  title: string;
  unitAmount: number; // cents
  quantity: number;
  lineTotal: number; // cents
  imageUrl: string | null;
}

export interface ValidatedCart {
  lines: ValidatedLine[];
  subtotal: number; // cents
  currency: string;
}

/** Format integer cents as a localized currency string. */
export function formatMoney(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Convert a numeric EUR price (e.g. 68.00) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
