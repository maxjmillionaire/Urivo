/*
 * Storefront theme handling. AI- or merchant-supplied theme values are
 * untrusted input — everything rendered into styles is validated here
 * (spec 6.5: sanitize every input, escape every output).
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export interface StorefrontTheme {
  tagline: string;
  background: string;
  structure: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
}

// Neutral, brand-agnostic fallback for a merchant storefront. Storefronts use
// the merchant's own AI-generated palette; this is only the safety default when
// nothing is supplied — intentionally not the Urivo brand colours.
const THEME_DEFAULTS: StorefrontTheme = {
  tagline: "",
  background: "#F6F4EF",
  structure: "#1C1B18",
  accent: "#9C7C4A",
  headingFont: "'Playfair Display', Georgia, serif",
  bodyFont: "'Inter', system-ui, sans-serif",
};

const ALLOWED_FONTS: Record<string, string> = {
  "playfair display": "'Playfair Display', Georgia, serif",
  didot: "Didot, Georgia, serif",
  georgia: "Georgia, serif",
  inter: "'Inter', system-ui, sans-serif",
  "sf pro display": "'SF Pro Display', system-ui, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
};

function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim())
    ? value.trim()
    : fallback;
}

function safeFont(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return ALLOWED_FONTS[value.trim().toLowerCase()] ?? fallback;
}

export function parseTheme(themeConfig: unknown): StorefrontTheme {
  const config = (themeConfig ?? {}) as Record<string, unknown>;
  const palette = (config.palette ?? {}) as Record<string, unknown>;
  const typography = (config.typography ?? {}) as Record<string, unknown>;

  return {
    tagline:
      typeof config.tagline === "string" ? config.tagline.slice(0, 200) : "",
    background: safeColor(palette.primaryBackground, THEME_DEFAULTS.background),
    structure: safeColor(palette.secondaryStructure, THEME_DEFAULTS.structure),
    accent: safeColor(palette.accentConversion, THEME_DEFAULTS.accent),
    headingFont: safeFont(typography.primaryHeader, THEME_DEFAULTS.headingFont),
    bodyFont: safeFont(typography.secondaryBody, THEME_DEFAULTS.bodyFont),
  };
}
