/*
 * Generative storefront DESIGN SYSTEM (the heart of Urivo's storefronts).
 *
 * Urivo does not fill a template with different colours. For every store the AI
 * acts as a Creative Director and emits a full, structured design system —
 * layout archetype, grid, type pairing, section order, card style, radius,
 * shadow, spacing, motion, image treatment, personality. A flexible renderer
 * then expresses it, so ten prompts yield ten genuinely different-looking
 * stores that share only one thing: exceptional quality.
 *
 * Everything here is UNTRUSTED input from the model. Following spec 6.5, every
 * field is validated against an allowlist or clamped to a safe range before it
 * ever reaches the DOM — no arbitrary fonts, colours, URLs or markup.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/* ----------------------------- structural vocab ---------------------------- */

export const NAV_VARIANTS = ["editorial", "centered", "bordered", "minimal"] as const;
export const HERO_VARIANTS = ["editorial", "split", "fullbleed", "statement"] as const;
export const CARD_VARIANTS = ["editorial", "framed", "overlay", "minimal"] as const;
export const FOOTER_VARIANTS = ["editorial", "bold", "minimal"] as const;
export const BUTTON_SHAPES = ["sharp", "soft", "pill"] as const;
export const SHADOW_LEVELS = ["none", "soft", "elevated"] as const;
export const IMAGE_TREATMENTS = ["flat", "duotone", "framed", "editorial"] as const;
export const MOTION_LEVELS = ["calm", "lively"] as const;
export const DENSITIES = ["airy", "balanced", "tight"] as const;
export const HEADING_CASES = ["none", "upper"] as const;
export const SECTION_KEYS = [
  "announcement",
  "hero",
  "marquee",
  "trust",
  "collection",
  "story",
  "highlights",
  "newsletter",
  "footer",
] as const;

export type NavVariant = (typeof NAV_VARIANTS)[number];
export type HeroVariant = (typeof HERO_VARIANTS)[number];
export type CardVariant = (typeof CARD_VARIANTS)[number];
export type FooterVariant = (typeof FOOTER_VARIANTS)[number];
export type ButtonShape = (typeof BUTTON_SHAPES)[number];
export type ShadowLevel = (typeof SHADOW_LEVELS)[number];
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];
export type MotionLevel = (typeof MOTION_LEVELS)[number];
export type Density = (typeof DENSITIES)[number];
export type HeadingCase = (typeof HEADING_CASES)[number];
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * The creative brief — the strategy the AI commits to BEFORE it designs
 * anything. Every visual decision emerges from these, and the imagery pipeline
 * reads the photography direction so a store's photos share one art direction.
 * Persisted with the store so edits and future generations stay coherent.
 */
export interface StoreBrief {
  audience: string;
  pricePoint: string;
  positioning: string;
  designPhilosophy: string;
  typographyDirection: string;
  photographyDirection: string;
  conversionStrategy: string;
}

import { parseNarrative, type NarrativeBlock } from "./narrative";

/** One authored proof point — a promise the brand actually makes. */
export interface ProofPoint {
  title: string;
  detail: string;
}

export interface StoreDesignSystem {
  personality: string;
  tagline?: string;
  brief?: StoreBrief;
  /** Customer-facing brand narrative for the story section (editorial, honest). */
  story?: string;
  /**
   * Risk-reduction promises, AUTHORED for this brand. The renderer never
   * supplies these: a guarantee the merchant did not make is a commercial term
   * they are bound to and — for shipping, returns or environmental claims in the
   * EU — a regulated one. No authored items means no trust section.
   */
  trust?: ProofPoint[];
  /** Reasons to want this brand, authored. Same rule: absent means unrendered. */
  highlights?: ProofPoint[];
  /** The authored emotional journey — the Creative Director's page composition.
   *  When present, the renderer expresses this instead of a fixed section order. */
  narrative?: NarrativeBlock[];
  palette: {
    background: string;
    surface: string;
    ink: string;
    muted: string;
    line: string;
    accent: string;
    accentInk: string;
  };
  fonts: { headingKey: string; bodyKey: string };
  typeStyle: {
    headingWeight: number;
    headingCase: HeadingCase;
    headingTracking: number; // em
    scale: number; // modular scale ratio
  };
  shape: {
    radius: number; // px
    buttonShape: ButtonShape;
    borderWidth: number; // px
    shadow: ShadowLevel;
  };
  space: { density: Density; container: number };
  layout: {
    nav: NavVariant;
    hero: HeroVariant;
    card: CardVariant;
    footer: FooterVariant;
    imageTreatment: ImageTreatment;
    motion: MotionLevel;
    announcement: string | null;
    sectionOrder: SectionKey[];
  };
}

/* --------------------------------- brand logo ------------------------------ */

export const LOGO_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

/** A merchant's logo, overlaid non-destructively on product shots. */
export interface StoreLogo {
  url: string;
  position: LogoPosition;
  sizePct: number; // width as % of the image
  opacity: number; // 0.2–1
}

/** Read + validate the store logo from theme_config (untrusted). Only our own
 *  https storage URLs are accepted into an <img src>. */
export function parseLogo(themeConfig: unknown): StoreLogo | null {
  const cfg = (themeConfig ?? {}) as Record<string, unknown>;
  const l = cfg.logo as Record<string, unknown> | undefined;
  if (!l || typeof l.url !== "string" || !/^https:\/\//.test(l.url)) return null;
  return {
    url: l.url,
    position: oneOf(l.position, LOGO_POSITIONS, "bottom-right"),
    sizePct: clampNum(l.sizePct, 6, 40, 18),
    opacity: clampNum(l.opacity, 0.2, 1, 1),
  };
}

/* ------------------------------- font library ------------------------------ */
/*
 * Curated, pairing-tested library. The AI selects a KEY; we resolve it to a
 * safe CSS stack + a Google Fonts import spec. No arbitrary font URLs.
 */
export interface FontDef {
  stack: string;
  import: string; // family spec for fonts.googleapis.com css2
}

export const FONT_LIBRARY: Record<string, FontDef> = {
  playfair: { stack: "'Playfair Display', Georgia, serif", import: "Playfair+Display:ital,wght@0,400;0,500;0,700;1,400" },
  cormorant: { stack: "'Cormorant Garamond', Georgia, serif", import: "Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400" },
  fraunces: { stack: "'Fraunces', Georgia, serif", import: "Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,800;1,9..144,400" },
  spectral: { stack: "'Spectral', Georgia, serif", import: "Spectral:ital,wght@0,300;0,400;0,600;1,400" },
  libre: { stack: "'Libre Baskerville', Georgia, serif", import: "Libre+Baskerville:ital,wght@0,400;0,700;1,400" },
  inter: { stack: "'Inter', system-ui, sans-serif", import: "Inter:wght@400;500;600;700" },
  manrope: { stack: "'Manrope', system-ui, sans-serif", import: "Manrope:wght@400;500;600;700;800" },
  dmsans: { stack: "'DM Sans', system-ui, sans-serif", import: "DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700" },
  spacegrotesk: { stack: "'Space Grotesk', system-ui, sans-serif", import: "Space+Grotesk:wght@400;500;600;700" },
  sora: { stack: "'Sora', system-ui, sans-serif", import: "Sora:wght@400;500;600;700" },
  jost: { stack: "'Jost', system-ui, sans-serif", import: "Jost:wght@400;500;600;700" },
  epilogue: { stack: "'Epilogue', system-ui, sans-serif", import: "Epilogue:wght@400;600;700;800" },
  archivo: { stack: "'Archivo', system-ui, sans-serif", import: "Archivo:wght@400;600;700;800;900" },
  syne: { stack: "'Syne', system-ui, sans-serif", import: "Syne:wght@400;600;700;800" },
  bebas: { stack: "'Bebas Neue', Impact, sans-serif", import: "Bebas+Neue" },
  ibmmono: { stack: "'IBM Plex Mono', ui-monospace, monospace", import: "IBM+Plex+Mono:wght@400;500;600" },
};

/** The font keys the AI may choose from (tuple for schema enums). */
export const FONT_KEYS = Object.keys(FONT_LIBRARY) as [string, ...string[]];

const DEFAULT_HEADING = "playfair";
const DEFAULT_BODY = "inter";

export function fontStack(key: string): string {
  return FONT_LIBRARY[key]?.stack ?? FONT_LIBRARY[DEFAULT_BODY].stack;
}

/** Build a single, deduped Google Fonts stylesheet URL for a design system. */
export function googleFontsUrl(ds: StoreDesignSystem): string {
  const specs = new Set<string>();
  const h = FONT_LIBRARY[ds.fonts.headingKey]?.import;
  const b = FONT_LIBRARY[ds.fonts.bodyKey]?.import;
  if (h) specs.add(h);
  if (b) specs.add(b);
  if (specs.size === 0) return "";
  const families = [...specs].map((s) => `family=${s}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/* ------------------------------- colour math ------------------------------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").slice(0, 6);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(hex: string, target: [number, number, number], amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r + (target[0] - r) * amt, g + (target[1] - g) * amt, b + (target[2] - b) * amt);
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
/** Pick a readable ink for a given surface. */
export function readableInk(surface: string): string {
  return luminance(surface) > 0.5 ? mix(surface, BLACK, 0.86) : "#ffffff";
}

/* -------------------------------- validation ------------------------------- */

function color(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX_COLOR.test(v.trim()) ? v.trim() : fallback;
}
function oneOf<T extends readonly string[]>(v: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function fontKey(v: unknown, fallback: string): string {
  return typeof v === "string" && FONT_LIBRARY[v] ? v : fallback;
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
/** Validate the optional creative brief; returns undefined unless it's usably
 *  complete (the fields that actually feed downstream — positioning + imagery). */
function parseBrief(raw: unknown): StoreBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const brief: StoreBrief = {
    audience: str(b.audience, 240),
    pricePoint: str(b.pricePoint, 80),
    positioning: str(b.positioning, 240),
    designPhilosophy: str(b.designPhilosophy, 300),
    typographyDirection: str(b.typographyDirection, 200),
    photographyDirection: str(b.photographyDirection, 400),
    conversionStrategy: str(b.conversionStrategy, 300),
  };
  return brief.positioning || brief.photographyDirection ? brief : undefined;
}
/** Validate authored proof points. Anything half-written is dropped rather than
 *  padded — a headline with no substantiation is worse than no section. */
function parseProof(raw: unknown, max: number): ProofPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return { title: str(o.title, 48), detail: str(o.detail, 160) };
    })
    .filter((p) => p.title && p.detail)
    .slice(0, max);
}
function snapWeight(v: unknown): number {
  const n = clampNum(v, 300, 900, 600);
  const steps = [300, 400, 500, 600, 700, 800, 900];
  return steps.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 600);
}

/**
 * Validate & normalise a raw model object into a safe StoreDesignSystem.
 * Missing/invalid fields fall back so a partial or hostile payload still yields
 * a coherent, premium store. Derives secondary palette roles when absent.
 */
export function parseDesignSystem(raw: unknown, productCount = 999): StoreDesignSystem {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pRaw = (r.palette ?? {}) as Record<string, unknown>;
  const fRaw = (r.fonts ?? {}) as Record<string, unknown>;
  const tRaw = (r.typeStyle ?? {}) as Record<string, unknown>;
  const sRaw = (r.shape ?? {}) as Record<string, unknown>;
  const spRaw = (r.space ?? {}) as Record<string, unknown>;
  const lRaw = (r.layout ?? {}) as Record<string, unknown>;

  const background = color(pRaw.background, "#F6F4EF");
  const ink = color(pRaw.ink, readableInk(background));
  const dark = luminance(background) <= 0.5;
  const surface = color(pRaw.surface, mix(background, dark ? WHITE : BLACK, 0.05));
  const muted = color(pRaw.muted, mix(ink, hexToRgb(background), 0.4));
  const line = color(pRaw.line, mix(ink, hexToRgb(background), dark ? 0.7 : 0.82));
  const accent = color(pRaw.accent, "#9C7C4A");
  const accentInk = color(pRaw.accentInk, readableInk(accent));

  const story = typeof r.story === "string" && r.story.trim() ? r.story.trim().slice(0, 400) : undefined;
  const trust = parseProof(r.trust, 4);
  const highlights = parseProof(r.highlights, 3);

  // section order — keep known keys, dedupe, guarantee the essentials + ends.
  const rawOrder = Array.isArray(lRaw.sectionOrder) ? (lRaw.sectionOrder as unknown[]) : [];
  let order = rawOrder
    .map((k) => (typeof k === "string" ? k : ""))
    .filter((k): k is SectionKey => (SECTION_KEYS as readonly string[]).includes(k));
  order = [...new Set(order)];
  if (!order.includes("hero")) order.unshift("hero");
  if (!order.includes("collection")) order.push("collection");

  /*
   * Sections are CONTENT-DRIVEN. A section the brand authored copy for is never
   * left unrendered, and a section with no authored copy is never conjured —
   * which is what used to happen, with the renderer inventing the shipping,
   * returns and sustainability promises the merchant then published.
   */
  const insertBefore = (key: SectionKey, anchor: SectionKey) => {
    if (order.includes(key)) return;
    const at = order.indexOf(anchor);
    order.splice(at === -1 ? order.length : at, 0, key);
  };
  if (story) insertBefore("story", "collection");
  if (highlights.length) insertBefore("highlights", "collection");
  // Risk reduction sits AFTER the catalogue — nearest the buying decision.
  if (trust.length && !order.includes("trust")) {
    const at = order.indexOf("collection");
    order.splice(at === -1 ? order.length : at + 1, 0, "trust");
  }

  order = order.filter((k) => k !== "footer");
  order.push("footer");

  const announcement =
    typeof lRaw.announcement === "string" && lRaw.announcement.trim()
      ? lRaw.announcement.trim().slice(0, 120)
      : null;

  return {
    personality:
      typeof r.personality === "string" ? r.personality.trim().slice(0, 80) : "Considered, premium",
    tagline: typeof r.tagline === "string" && r.tagline.trim() ? r.tagline.trim().slice(0, 160) : undefined,
    brief: parseBrief(r.brief),
    story,
    trust: trust.length ? trust : undefined,
    highlights: highlights.length ? highlights : undefined,
    narrative: parseNarrative(r.narrative, productCount) ?? undefined,
    palette: { background, surface, ink, muted, line, accent, accentInk },
    fonts: {
      headingKey: fontKey(fRaw.headingKey, DEFAULT_HEADING),
      bodyKey: fontKey(fRaw.bodyKey, DEFAULT_BODY),
    },
    typeStyle: {
      headingWeight: snapWeight(tRaw.headingWeight),
      headingCase: oneOf(tRaw.headingCase, HEADING_CASES, "none"),
      headingTracking: clampNum(tRaw.headingTracking, -0.04, 0.3, 0),
      scale: clampNum(tRaw.scale, 1.12, 1.4, 1.25),
    },
    shape: {
      radius: clampNum(sRaw.radius, 0, 32, 6),
      buttonShape: oneOf(sRaw.buttonShape, BUTTON_SHAPES, "soft"),
      borderWidth: clampNum(sRaw.borderWidth, 0, 3, 1),
      shadow: oneOf(sRaw.shadow, SHADOW_LEVELS, "soft"),
    },
    space: {
      density: oneOf(spRaw.density, DENSITIES, "balanced"),
      container: clampNum(spRaw.container, 1040, 1440, 1200),
    },
    layout: {
      nav: oneOf(lRaw.nav, NAV_VARIANTS, "editorial"),
      hero: oneOf(lRaw.hero, HERO_VARIANTS, "editorial"),
      card: oneOf(lRaw.card, CARD_VARIANTS, "editorial"),
      footer: oneOf(lRaw.footer, FOOTER_VARIANTS, "editorial"),
      imageTreatment: oneOf(lRaw.imageTreatment, IMAGE_TREATMENTS, "flat"),
      motion: oneOf(lRaw.motion, MOTION_LEVELS, "calm"),
      announcement,
      sectionOrder: order,
    },
  };
}

/* --------------------- adapter: legacy theme → design system --------------- */

import type { StorefrontTheme } from "@/lib/storefront";

/**
 * Bridge stores generated under the older 3-colour/2-font theme onto the new
 * engine so nothing breaks while the generator is upgraded. Produces a coherent
 * editorial system derived from the merchant's palette.
 */
export function themeToDesignSystem(theme: StorefrontTheme): StoreDesignSystem {
  const headingKey = /serif/i.test(theme.headingFont) ? "playfair" : "manrope";
  return parseDesignSystem({
    personality: "Editorial, premium",
    tagline: theme.tagline || undefined,
    palette: { background: theme.background, ink: theme.structure, accent: theme.accent },
    fonts: { headingKey, bodyKey: "inter" },
    typeStyle: { headingWeight: 500, headingCase: "none", headingTracking: -0.01, scale: 1.28 },
    shape: { radius: 4, buttonShape: "pill", borderWidth: 1, shadow: "soft" },
    space: { density: "airy", container: 1200 },
    layout: {
      nav: "editorial",
      hero: "editorial",
      card: "editorial",
      footer: "editorial",
      imageTreatment: "flat",
      motion: "calm",
      announcement: null,
      sectionOrder: ["hero", "collection", "footer"],
    },
  });
}

/* ------------------------------ spacing helpers ---------------------------- */

export function sectionPadding(density: Density): string {
  return density === "airy" ? "clamp(4.5rem, 9vw, 9rem)" : density === "tight" ? "clamp(2.5rem, 5vw, 5rem)" : "clamp(3.5rem, 7vw, 7rem)";
}
