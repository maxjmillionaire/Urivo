/*
 * The Narrative model — Urivo's storefronts as a CONTROLLED EMOTIONAL JOURNEY,
 * not a stack of themed sections.
 *
 * A theme engine asks "which hero layout?". A Creative Director asks "what story
 * makes someone want THIS product, in what order, at what intensity?". So the AI
 * no longer picks section keys — it authors a `narrative`: an ordered list of
 * persuasion BEATS. Each beat has a psychological `intent`, an `emphasis` (its
 * emotional volume), and fully AUTHORED content specific to this brand and these
 * products. The renderer is a faithful typesetting surface — it renders what the
 * Creative Director wrote, it never supplies boilerplate.
 *
 * Everything here is UNTRUSTED model output (spec 6.5): every field is clamped,
 * every product reference is bounded to the real catalogue, malformed beats are
 * dropped, and the essential beats (a hook, the shop) are guaranteed.
 */

export type Emphasis = "calm" | "bold";

export const BLOCK_KINDS = [
  "hero", // the hook — an IDEA or the hero product, never just the wordmark
  "marquee", // rhythm — a few authored proof phrases in motion
  "spotlight", // desire — one product, large, benefit-led (the Seed move)
  "pillars", // desire — 2–4 reasons this is worth wanting
  "proof", // credibility — ingredients / materials / how it works
  "story", // meaning — why the brand exists (authored)
  "quote", // emotional peak — one line, big type, air
  "trust", // risk reduction — authored guarantees true to the brand
  "faq", // objection handling
  "collection", // the shop
  "cta", // the close
  "newsletter", // retention
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

interface Base {
  intent: string; // the psychological reason this beat exists (the AI's own words)
  emphasis: Emphasis;
}
export interface HeroBlock extends Base {
  kind: "hero";
  eyebrow: string | null;
  headline: string; // an idea / benefit / promise — NEVER the brand name
  subhead: string | null;
  ctaLabel: string;
  heroProductIndex: number | null; // set → product-led hero
}
export interface MarqueeBlock extends Base {
  kind: "marquee";
  phrases: string[];
}
export interface SpotlightBlock extends Base {
  kind: "spotlight";
  productIndex: number;
  eyebrow: string | null;
  headline: string;
  benefits: string[];
  ctaLabel: string;
}
export interface PillarsBlock extends Base {
  kind: "pillars";
  title: string | null;
  items: { title: string; detail: string }[];
}
export interface ProofBlock extends Base {
  kind: "proof";
  title: string;
  items: { label: string; detail: string }[];
}
export interface StoryBlock extends Base {
  kind: "story";
  eyebrow: string | null;
  headline: string;
  body: string;
}
export interface QuoteBlock extends Base {
  kind: "quote";
  text: string;
  attribution: string | null;
}
export interface TrustBlock extends Base {
  kind: "trust";
  items: { title: string; detail: string }[];
}
export interface FaqBlock extends Base {
  kind: "faq";
  items: { q: string; a: string }[];
}
export interface CollectionBlock extends Base {
  kind: "collection";
  title: string | null;
}
export interface CtaBlock extends Base {
  kind: "cta";
  headline: string;
  subhead: string | null;
  ctaLabel: string;
}
export interface NewsletterBlock extends Base {
  kind: "newsletter";
  headline: string;
  subhead: string;
}

export type NarrativeBlock =
  | HeroBlock
  | MarqueeBlock
  | SpotlightBlock
  | PillarsBlock
  | ProofBlock
  | StoryBlock
  | QuoteBlock
  | TrustBlock
  | FaqBlock
  | CollectionBlock
  | CtaBlock
  | NewsletterBlock;

/* -------------------------------- validation ------------------------------- */

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const sOrNull = (v: unknown, max: number): string | null => {
  const t = s(v, max);
  return t || null;
};
const emphasis = (v: unknown): Emphasis => (v === "bold" ? "bold" : "calm");
const strList = (v: unknown, max: number, itemMax: number): string[] =>
  Array.isArray(v) ? v.map((x) => s(x, itemMax)).filter(Boolean).slice(0, max) : [];
const productIndex = (v: unknown, count: number): number | null => {
  const n = typeof v === "number" ? Math.floor(v) : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n < count ? n : null;
};

interface RawBlock {
  kind?: unknown;
  intent?: unknown;
  emphasis?: unknown;
  eyebrow?: unknown;
  headline?: unknown;
  subhead?: unknown;
  body?: unknown;
  title?: unknown;
  text?: unknown;
  attribution?: unknown;
  ctaLabel?: unknown;
  heroProductIndex?: unknown;
  productIndex?: unknown;
  phrases?: unknown;
  benefits?: unknown;
  items?: unknown;
}

function pairs(v: unknown, aKey: string, bKey: string, aMax: number, bMax: number, max: number): { a: string; b: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return { a: s(o[aKey], aMax), b: s(o[bKey], bMax) };
    })
    .filter((p) => p.a && p.b)
    .slice(0, max);
}

/** Validate a single raw beat into a typed block, or null to drop it. */
function parseBlock(raw: RawBlock, productCount: number): NarrativeBlock | null {
  const kind = raw.kind;
  if (typeof kind !== "string" || !(BLOCK_KINDS as readonly string[]).includes(kind)) return null;
  const base = { intent: s(raw.intent, 160) || "persuade", emphasis: emphasis(raw.emphasis) };

  switch (kind as BlockKind) {
    case "hero": {
      const headline = s(raw.headline, 120);
      if (!headline) return null;
      return { ...base, kind: "hero", eyebrow: sOrNull(raw.eyebrow, 40), headline, subhead: sOrNull(raw.subhead, 200), ctaLabel: s(raw.ctaLabel, 40) || "Shop now", heroProductIndex: productIndex(raw.heroProductIndex, productCount) };
    }
    case "marquee": {
      const phrases = strList(raw.phrases, 8, 48);
      return phrases.length >= 2 ? { ...base, kind: "marquee", phrases } : null;
    }
    case "spotlight": {
      const pi = productIndex(raw.productIndex, productCount);
      const headline = s(raw.headline, 120);
      if (pi === null || !headline) return null;
      return { ...base, kind: "spotlight", productIndex: pi, eyebrow: sOrNull(raw.eyebrow, 40), headline, benefits: strList(raw.benefits, 5, 90), ctaLabel: s(raw.ctaLabel, 40) || "Add to bag" };
    }
    case "pillars": {
      const items = pairs(raw.items, "title", "detail", 48, 160, 4).map((p) => ({ title: p.a, detail: p.b }));
      return items.length >= 2 ? { ...base, kind: "pillars", title: sOrNull(raw.title, 80), items } : null;
    }
    case "proof": {
      const items = pairs(raw.items, "label", "detail", 60, 200, 6).map((p) => ({ label: p.a, detail: p.b }));
      const title = s(raw.title, 80);
      return title && items.length >= 3 ? { ...base, kind: "proof", title, items } : null;
    }
    case "story": {
      const headline = s(raw.headline, 120);
      const body = s(raw.body, 500);
      return headline && body ? { ...base, kind: "story", eyebrow: sOrNull(raw.eyebrow, 40), headline, body } : null;
    }
    case "quote": {
      const text = s(raw.text, 240);
      return text ? { ...base, kind: "quote", text, attribution: sOrNull(raw.attribution, 60) } : null;
    }
    case "trust": {
      const items = pairs(raw.items, "title", "detail", 48, 120, 4).map((p) => ({ title: p.a, detail: p.b }));
      return items.length >= 3 ? { ...base, kind: "trust", items } : null;
    }
    case "faq": {
      const items = pairs(raw.items, "q", "a", 120, 320, 6).map((p) => ({ q: p.a, a: p.b }));
      return items.length >= 2 ? { ...base, kind: "faq", items } : null;
    }
    case "collection":
      return { ...base, kind: "collection", title: sOrNull(raw.title, 80) };
    case "cta": {
      const headline = s(raw.headline, 120);
      return headline ? { ...base, kind: "cta", headline, subhead: sOrNull(raw.subhead, 200), ctaLabel: s(raw.ctaLabel, 40) || "Shop the collection" } : null;
    }
    case "newsletter": {
      const headline = s(raw.headline, 120);
      return headline ? { ...base, kind: "newsletter", headline, subhead: s(raw.subhead, 200) || "Early access and quiet updates." } : null;
    }
    default:
      return null;
  }
}

/**
 * Validate the whole authored narrative. Drops malformed beats, dedupes the
 * singular beats (one hero, one collection, one newsletter), guarantees a hook
 * and the shop exist, and caps the length. Returns null when there's no usable
 * narrative (caller falls back to the legacy renderer).
 */
export function parseNarrative(raw: unknown, productCount: number): NarrativeBlock[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NarrativeBlock[] = [];
  const singular = new Set<BlockKind>(["hero", "collection", "newsletter", "story"]);
  const seen = new Set<BlockKind>();

  for (const item of raw.slice(0, 16)) {
    const block = parseBlock((item ?? {}) as RawBlock, productCount);
    if (!block) continue;
    if (singular.has(block.kind)) {
      if (seen.has(block.kind)) continue;
      seen.add(block.kind);
    }
    out.push(block);
    if (out.length >= 11) break;
  }

  // A hook is mandatory; if the model didn't give a usable one, there's no
  // narrative to trust — fall back rather than fabricate.
  if (!out.some((b) => b.kind === "hero")) return null;
  // The shop must exist.
  if (!out.some((b) => b.kind === "collection")) {
    out.push({ kind: "collection", intent: "let them buy", emphasis: "calm", title: null });
  }
  return out;
}
