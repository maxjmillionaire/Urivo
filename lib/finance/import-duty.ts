/*
 * EU import duty on low-value consignments.
 *
 * Until 30 June 2026 a parcel worth under €150 entered the EU duty-free, and
 * essentially every dropshipping margin ever calculated — including Urivo's —
 * quietly assumed that. The Council agreed on 13 November 2025 to remove the
 * exemption and it ended on 1 July 2026:
 *
 *   from 2026-07-01   €3 flat duty per customs declaration line item
 *   from 2026-11-01   plus €2 customs handling per line item (€5 combined)
 *   until 2028-07-01  transitional; then the EU Customs Data Hub goes live and
 *                     normal tariff classification applies per product
 *
 * Why this belongs in the pricing path rather than in a help article: on an €8
 * product these charges are not a rounding error, they are the margin. A
 * platform that tells a founder "65% margin" on a number that ignores €5 of
 * duty has not made an estimate, it has made a false statement — and the
 * founder discovers it after they have paid for ads.
 *
 * Deliberately modelled as a per-LINE-ITEM charge rather than per parcel,
 * because that is how the rule is written and it is the conservative reading
 * for a multi-item order.
 *
 * Pure and date-injectable: the November step is in the future at the time of
 * writing and must be testable without waiting for a calendar.
 */

/** EU-27, ISO-3166-1 alpha-2. Goods already inside move freely. */
const EU_MEMBER_STATES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
]);

/** The flat duty replacing the €150 exemption. */
export const FLAT_DUTY_EUR = 3;
/** The customs handling fee that joins it. */
export const HANDLING_FEE_EUR = 2;

const DUTY_FROM = new Date("2026-07-01T00:00:00Z");
const HANDLING_FROM = new Date("2026-11-01T00:00:00Z");
/** After this the Customs Data Hub applies real tariff codes; the flat rate ends. */
export const TRANSITIONAL_UNTIL = new Date("2028-07-01T00:00:00Z");

export interface ImportDutyInput {
  /** ISO-2 origin. Null/unknown is treated as an import — see below. */
  shipsFromCountry?: string | null;
  /** ISO-2 destination. Defaults to DE, Urivo's home market. */
  shipsToCountry?: string | null;
  now?: Date;
}

function normalizeCountry(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export function isEuCountry(code: string | null | undefined): boolean {
  const c = normalizeCountry(code);
  return c != null && EU_MEMBER_STATES.has(c);
}

/**
 * Import charges in EUR for one line item of an order.
 *
 * Unknown origin counts as an import. This is the direction that protects the
 * merchant: over-stating cost prices a product slightly high and costs a little
 * volume, while under-stating it sells at a loss the founder does not discover
 * until the parcels are already moving. Most dropshipping supply is non-EU
 * anyway, so the assumption is also usually right.
 */
export function importDutyEur(input: ImportDutyInput = {}): number {
  const now = input.now ?? new Date();
  const to = normalizeCountry(input.shipsToCountry) ?? "DE";

  // Only EU imports are modelled. Other destinations have their own regimes and
  // guessing at them would be worse than declining to.
  if (!EU_MEMBER_STATES.has(to)) return 0;

  // Inside the EU there is no customs line at all.
  if (isEuCountry(input.shipsFromCountry)) return 0;

  if (now < DUTY_FROM) return 0;
  return now < HANDLING_FROM ? FLAT_DUTY_EUR : FLAT_DUTY_EUR + HANDLING_FEE_EUR;
}

/**
 * Landed cost: what the merchant actually pays to put one unit in a customer's
 * hands, before shipping. This — not the supplier's price — is what a margin
 * must be calculated against.
 */
export function landedCostEur(supplierCostEur: number, input: ImportDutyInput = {}): number {
  return supplierCostEur + importDutyEur(input);
}

/**
 * True margin on a sale, net of import charges. Returns null when the price is
 * zero or negative, which is not a margin of 0% but an absence of one.
 */
export function marginAfterDuty(
  priceEur: number,
  supplierCostEur: number,
  input: ImportDutyInput = {},
): number | null {
  if (!(priceEur > 0)) return null;
  return (priceEur - landedCostEur(supplierCostEur, input)) / priceEur;
}

/**
 * What the merchant is told, when duty applies. Plain and specific: a founder
 * who reads "€5 import charges per item are included" can check the arithmetic
 * themselves, which is the difference between a number they trust and one they
 * merely accept.
 */
export function importDutyNote(input: ImportDutyInput = {}): string | null {
  const duty = importDutyEur(input);
  if (duty === 0) return null;
  return `Includes €${duty} EU import charges per item — the €150 duty exemption ended on 1 July 2026.`;
}
