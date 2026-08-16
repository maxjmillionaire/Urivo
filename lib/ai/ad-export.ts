/*
 * From "generated" to "running" without retyping anything.
 *
 * Copy-pasting an ad set by hand is roughly twenty operations per ad: headline,
 * body, CTA, URL, four times over, into a form that rejects half of them for
 * length. It is the step where a good plan quietly dies on a Tuesday evening.
 * These are the two import formats the ad platforms actually accept, generated
 * from ads Urivo already wrote and already tracks.
 *
 * The tracking link goes in as the destination. That is the real prize: a
 * merchant who exports never types a URL at all, so the one manual step that
 * breaks attribution stops existing for them.
 *
 * Two deliberate constraints:
 *
 *   Everything imports PAUSED. An import that can start spending money the
 *   moment it lands is a liability, not a convenience. The merchant chooses
 *   budgets and audiences and presses go — Urivo does not press go for them.
 *
 *   Google gets ONE responsive search ad, not one per headline. That is how
 *   RSAs work: Google takes up to 15 headlines and 4 descriptions and mixes
 *   them itself. Exporting one ad per headline would produce a file Google
 *   rejects, and pretending otherwise would be a lie told in CSV.
 */

import { PLATFORM_LIMITS, trimToWord, type AdPlatform } from "./ad-platforms";

export interface ExportableCreative {
  platform: string;
  format: string;
  angle: string;
  headline: string;
  primaryText: string;
  cta: string;
  trackingUrl: string;
}

export interface ExportResult {
  /** The file body, or null when there is nothing valid to export. */
  csv: string | null;
  filename: string;
  /** How many ads the merchant will find in the file. */
  ads: number;
  /** Why the export is empty or reduced — always shown, never swallowed. */
  note: string | null;
}

/*
 * Excel decides a CSV's encoding by sniffing the first bytes. Without a BOM it
 * reads UTF-8 as Latin-1 and every € becomes "â‚¬" — in the price of the ad the
 * merchant is about to run. One invisible character prevents it.
 */
const BOM = "﻿";

/** RFC 4180: quote everything, double the quotes inside. Ad copy is full of both. */
export function csvCell(value: string): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

/** CRLF — Excel and Google Ads Editor both expect it; bare LF misparses in Excel. */
function csvFile(rows: string[][]): string {
  return BOM + rows.map(csvRow).join("\r\n") + "\r\n";
}

/** Ad platforms reject an entire upload over one long field. Never ship one. */
function fit(text: string, platform: AdPlatform, field: "headline" | "primaryText"): string {
  const limit = PLATFORM_LIMITS[platform][field];
  return text.length <= limit ? text : trimToWord(text, limit);
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "store";

/* ------------------------------------------------------------------ */
/* Google Ads Editor — responsive search ads                           */
/* ------------------------------------------------------------------ */

/** Google refuses an RSA with fewer than these. Better to say so than to ship a reject. */
const RSA_MIN_HEADLINES = 3;
const RSA_MIN_DESCRIPTIONS = 2;
const RSA_MAX_HEADLINES = 15;
const RSA_MAX_DESCRIPTIONS = 4;

/**
 * One responsive search ad, built from every Google creative in the set.
 *
 * A consequence worth stating plainly rather than hiding: because Google mixes
 * the headlines itself, one RSA carries one final URL. Google results are
 * therefore credited to this ad as a whole, not to individual headlines —
 * the platform offers no way to do otherwise. Meta keeps one ad per creative
 * and stays individually measured.
 */
export function toGoogleRsaCsv(creatives: ExportableCreative[], storeName: string): ExportResult {
  const filename = `${slug(storeName)}-google-rsa.csv`;
  const tracked = creatives.filter((c) => c.trackingUrl);
  const google = tracked.filter((c) => c.platform === "Google");

  if (google.length === 0) {
    return { csv: null, filename, ads: 0, note: "No Google ads in this set. Generate a plan that includes Google, or export for Meta instead." };
  }

  /*
   * An RSA is not "a Google ad" the way a Meta ad is an ad. It is a pool of up
   * to 15 headlines that Google recombines per auction, and its whole strength
   * is variety — three headlines is the legal minimum, not a good ad.
   *
   * A generated plan usually contains only two or three Google creatives,
   * which would leave the export refusing to build for almost everyone. So the
   * pool is filled out from the rest of the set: the ads are for one store and
   * one offer, and a headline that fits Google's 30 characters is usable on
   * Google whichever platform it was written for. Google-written copy leads,
   * so the platform's own voice sets the tone; the note says exactly what was
   * borrowed rather than letting the merchant discover it in Ads Editor.
   */
  const native = dedupe(google.map((c) => c.headline.trim())).filter((h) => h.length <= PLATFORM_LIMITS.Google.headline);
  const borrowed = dedupe(
    tracked.filter((c) => c.platform !== "Google").map((c) => c.headline.trim()),
  ).filter((h) => h.length <= PLATFORM_LIMITS.Google.headline && !native.includes(h));

  const headlines = dedupe([...native, ...borrowed]).slice(0, RSA_MAX_HEADLINES);
  const borrowedUsed = headlines.filter((h) => borrowed.includes(h)).length;

  /*
   * Google-written descriptions may be trimmed — they were written to 90 and
   * a cut is a safety net that rarely fires. Borrowed ones are taken only if
   * they already fit. A Meta body squeezed from 125 characters into 90 ends
   * mid-thought ("...shaving-sharp out of the"), and a dangling sentence in a
   * live search ad is worse than one description fewer.
   */
  const descriptions = dedupe([
    ...google.map((c) => fit(c.primaryText, "Google", "primaryText")),
    ...tracked
      .filter((c) => c.platform !== "Google")
      .map((c) => c.primaryText.trim())
      .filter((d) => d.length <= PLATFORM_LIMITS.Google.primaryText),
  ].filter((d) => d.length > 0)).slice(0, RSA_MAX_DESCRIPTIONS);

  if (headlines.length < RSA_MIN_HEADLINES || descriptions.length < RSA_MIN_DESCRIPTIONS) {
    return {
      csv: null,
      filename,
      ads: 0,
      note: `Google needs at least ${RSA_MIN_HEADLINES} headlines and ${RSA_MIN_DESCRIPTIONS} descriptions in one responsive ad, and this set yields ${headlines.length} and ${descriptions.length} that fit its 30-character limit. Generate again for a fuller set — a file with fewer would be rejected at upload.`,
    };
  }

  const campaign = `${storeName} — Search`;
  const adGroup = google[0]?.angle ? `${storeName} — ${google[0].angle}` : `${storeName} — Search`;

  const header = [
    "Campaign",
    "Ad Group",
    "Ad type",
    ...Array.from({ length: RSA_MAX_HEADLINES }, (_, i) => `Headline ${i + 1}`),
    ...Array.from({ length: RSA_MAX_DESCRIPTIONS }, (_, i) => `Description ${i + 1}`),
    "Final URL",
    "Campaign Status",
    "Ad Group Status",
    "Status",
  ];

  const row = [
    campaign,
    adGroup,
    "Responsive search ad",
    ...pad(headlines, RSA_MAX_HEADLINES),
    ...pad(descriptions, RSA_MAX_DESCRIPTIONS),
    // The tracked destination. The merchant never types a URL, so the one step
    // that silently breaks measurement cannot be got wrong.
    google[0].trackingUrl,
    "Paused",
    "Paused",
    "Paused",
  ];

  return {
    csv: csvFile([header, row]),
    filename,
    ads: 1,
    note:
      `${headlines.length} headlines and ${descriptions.length} descriptions in one responsive ad — that is how Google runs search ads, recombining them per search.` +
      (borrowedUsed > 0
        ? ` ${borrowedUsed} of the headlines came from your other ads because they fit Google's 30-character limit; more variety is how an RSA earns its keep.`
        : "") +
      " Because Google mixes the headlines itself, results come back for the ad as a whole rather than per headline. It imports paused — set your budget and keywords first.",
  };
}

/* ------------------------------------------------------------------ */
/* Meta Ads Manager — bulk import                                      */
/* ------------------------------------------------------------------ */

/*
 * Meta's own CTA vocabulary. The importer rejects anything outside it, so the
 * model's phrasing is mapped rather than passed through; an unrecognised verb
 * falls back to LEARN_MORE, which is always accepted.
 */
const META_CTA: Record<string, string> = {
  "shop now": "SHOP_NOW",
  "buy now": "SHOP_NOW",
  "order now": "ORDER_NOW",
  "learn more": "LEARN_MORE",
  "sign up": "SIGN_UP",
  "get offer": "GET_OFFER",
  "see menu": "SEE_MENU",
  "contact us": "CONTACT_US",
  "book now": "BOOK_TRAVEL",
  "download": "DOWNLOAD",
  "subscribe": "SUBSCRIBE",
  "get quote": "GET_QUOTE",
  "apply now": "APPLY_NOW",
  "explore": "LEARN_MORE",
  "discover": "LEARN_MORE",
  "shop the collection": "SHOP_NOW",
};

export function metaCta(cta: string): string {
  return META_CTA[cta.trim().toLowerCase()] ?? "LEARN_MORE";
}

/**
 * One row per ad, each with its own tracking link.
 *
 * Unlike Google, Meta runs the creative as written, so every ad here stays
 * individually measurable — clicks and revenue land against this exact ad.
 */
export function toMetaBulkCsv(creatives: ExportableCreative[], storeName: string): ExportResult {
  const filename = `${slug(storeName)}-meta-ads.csv`;
  const meta = creatives.filter((c) => c.platform === "Meta" && c.trackingUrl);

  if (meta.length === 0) {
    return { csv: null, filename, ads: 0, note: "No Meta ads in this set. Generate a plan that includes Meta, or export for Google instead." };
  }

  const header = [
    "Campaign Name",
    "Campaign Objective",
    "Campaign Status",
    "Ad Set Name",
    "Ad Set Daily Budget",
    "Ad Set Status",
    "Ad Name",
    "Title",
    "Body",
    "Link",
    "Call to Action",
    "Ad Status",
  ];

  const campaign = `${storeName} — Conversions`;
  const rows = meta.map((c, i) => [
    campaign,
    "OUTCOME_SALES",
    "PAUSED",
    // Grouped by angle: the thing being tested is the angle, not the wording,
    // and Meta optimises within an ad set.
    `${storeName} — ${c.angle || `Set ${i + 1}`}`,
    /*
     * Left empty on purpose. A budget Urivo invented would be a number the
     * merchant never chose, imported into an account that can spend it. They
     * fill this in once, deliberately, and it is theirs.
     */
    "",
    "PAUSED",
    `${c.angle || "Ad"} — ${c.format || "Feed"} ${i + 1}`,
    fit(c.headline, "Meta", "headline"),
    fit(c.primaryText, "Meta", "primaryText"),
    c.trackingUrl,
    metaCta(c.cta),
    "PAUSED",
  ]);

  return {
    csv: csvFile([header, ...rows]),
    filename,
    ads: rows.length,
    note: `${rows.length} ${rows.length === 1 ? "ad" : "ads"}, each with its own tracked link, so results come back per ad. Everything imports paused and the daily budget is left blank — set it yourself before enabling.`,
  };
}

/* ------------------------------------------------------------------ */

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

function pad(values: string[], length: number): string[] {
  return Array.from({ length }, (_, i) => values[i] ?? "");
}

export const EXPORT_FORMATS = ["google", "meta"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function buildExport(
  format: ExportFormat,
  creatives: ExportableCreative[],
  storeName: string,
): ExportResult {
  return format === "google" ? toGoogleRsaCsv(creatives, storeName) : toMetaBulkCsv(creatives, storeName);
}
