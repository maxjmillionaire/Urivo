/*
 * GPSR — product safety information on a listing (Regulation (EU) 2023/988).
 *
 * Article 19 requires a distance-selling offer to carry the manufacturer's
 * identity and contact details, the EU responsible person for goods made
 * outside the EU, an identifier for the specific product, and any warnings —
 * all visible BEFORE the purchase, not in a footer or a PDF.
 *
 * Two rules, and they are the same two the storefront applies everywhere else:
 *
 * 1. NEVER AUTHOR IT. Urivo cannot invent a manufacturer's registered address.
 *    A generated address is a false statement about a real company on a
 *    document a regulator reads, which is a categorically worse outcome than a
 *    blank. So this module reports what is missing; it never fills it in.
 *
 * 2. TELL THE MERCHANT, NOT THE SHOPPER. An incomplete listing is the
 *    merchant's problem to fix and the dashboard's job to raise. The storefront
 *    shows what exists and stays silent about what does not — a shopper-facing
 *    "safety information missing" banner helps nobody and costs the sale.
 *
 * Pure, so the rule is testable without a database or a browser.
 */

export interface GpsrFields {
  manufacturer_name?: string | null;
  manufacturer_address?: string | null;
  manufacturer_email?: string | null;
  eu_responsible_name?: string | null;
  eu_responsible_address?: string | null;
  eu_responsible_email?: string | null;
  product_identifier?: string | null;
  safety_warnings?: string | null;
}

export interface GpsrEntry {
  label: string;
  value: string;
}

/** The same eight fields as an editable form: camelCase, never null. */
export interface GpsrForm {
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  euResponsibleName: string;
  euResponsibleAddress: string;
  euResponsibleEmail: string;
  productIdentifier: string;
  safetyWarnings: string;
}

/** Column ↔ form-field pairing, so the mapping has one definition. */
export const GPSR_COLUMNS: [keyof GpsrForm, keyof GpsrFields][] = [
  ["manufacturerName", "manufacturer_name"],
  ["manufacturerAddress", "manufacturer_address"],
  ["manufacturerEmail", "manufacturer_email"],
  ["euResponsibleName", "eu_responsible_name"],
  ["euResponsibleAddress", "eu_responsible_address"],
  ["euResponsibleEmail", "eu_responsible_email"],
  ["productIdentifier", "product_identifier"],
  ["safetyWarnings", "safety_warnings"],
];

/**
 * Read a database row into form state.
 *
 * Tolerates a row that has none of these columns: on an environment where
 * migration 0050 has not been applied, the merchant sees empty fields rather
 * than a catalogue that fails to load.
 */
export function gpsrFormFrom(row: Record<string, unknown> | null | undefined): GpsrForm {
  const out = {} as GpsrForm;
  for (const [field, column] of GPSR_COLUMNS) {
    const v = row?.[column];
    out[field] = typeof v === "string" ? v : "";
  }
  return out;
}

/**
 * Normalise a partial form into a complete one, trimming every value.
 *
 * Exists so callers building form state never reach for an `as GpsrForm` cast —
 * a cast would keep compiling on the day someone adds a ninth field and forgets
 * one of the places it has to be carried through.
 */
export function gpsrFormOf(source: Partial<GpsrForm> | null | undefined): GpsrForm {
  const out = {} as GpsrForm;
  for (const [field] of GPSR_COLUMNS) out[field] = (source?.[field] ?? "").trim();
  return out;
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/**
 * The fields a complete listing carries.
 *
 * `safety_warnings` is deliberately NOT required: plenty of products genuinely
 * carry no warning, and demanding one would teach merchants to write filler
 * into a field regulators read. The manufacturer block and the identifier are
 * required because every physical product has them.
 */
const REQUIRED: [keyof GpsrFields, string][] = [
  ["manufacturer_name", "Manufacturer"],
  ["manufacturer_address", "Manufacturer address"],
  ["manufacturer_email", "Manufacturer contact"],
  ["product_identifier", "Product identifier"],
];

/**
 * Which required fields are missing.
 *
 * The EU responsible person is conditional — it is required only when the
 * manufacturer is established outside the EU. Urivo does not know where that
 * is, so it is reported as missing only once the merchant has named a
 * manufacturer, at which point the question is answerable by the one person who
 * can answer it. Guessing either way would be inventing a legal fact.
 */
export function missingGpsrFields(p: GpsrFields): string[] {
  const missing = REQUIRED.filter(([key]) => clean(p[key]) == null).map(([, label]) => label);
  const hasManufacturer = clean(p.manufacturer_name) != null;
  const hasResponsible = clean(p.eu_responsible_name) != null && clean(p.eu_responsible_address) != null;
  if (hasManufacturer && !hasResponsible) {
    missing.push("EU responsible person (if the manufacturer is outside the EU)");
  }
  return missing;
}

/** True when the listing carries everything Article 19 asks of it. */
export function isGpsrComplete(p: GpsrFields): boolean {
  return missingGpsrFields(p).length === 0;
}

/**
 * The block the storefront renders, as label/value pairs.
 *
 * Only populated fields appear. An empty array means the merchant has supplied
 * nothing and the product page renders no section at all, rather than a heading
 * over a blank.
 */
export function gpsrEntries(p: GpsrFields): GpsrEntry[] {
  const out: GpsrEntry[] = [];
  const manufacturer = [clean(p.manufacturer_name), clean(p.manufacturer_address), clean(p.manufacturer_email)]
    .filter(Boolean)
    .join(" · ");
  if (manufacturer) out.push({ label: "Manufacturer", value: manufacturer });

  const responsible = [clean(p.eu_responsible_name), clean(p.eu_responsible_address), clean(p.eu_responsible_email)]
    .filter(Boolean)
    .join(" · ");
  if (responsible) out.push({ label: "EU responsible person", value: responsible });

  const identifier = clean(p.product_identifier);
  if (identifier) out.push({ label: "Product identifier", value: identifier });

  const warnings = clean(p.safety_warnings);
  if (warnings) out.push({ label: "Safety information", value: warnings });

  return out;
}
