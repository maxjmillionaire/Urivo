import { parseDesignSystem, type StoreDesignSystem } from "./design-system";

/*
 * Reference design systems — proof that one engine renders radically different
 * brands, and (later) few-shot exemplars for the Creative-Director generator.
 * Each is a complete, distinct visual language: different layout, type, shape,
 * spacing, motion and personality. The ONLY thing they share is quality.
 *
 * Their copy is written to be safe as a few-shot exemplar: brand-specific,
 * concrete, and free of anything a real merchant could not stand behind on
 * their first day — no invented origins, certifications or eco claims.
 */

export interface StylePreset {
  key: string;
  label: string;
  ds: StoreDesignSystem;
}

// 1 — AUREUM · luxury watches. Minimal, editorial, monochrome + bronze. Sharp,
// airy, elegant serif set large. Feels like a quiet gallery.
const AUREUM = parseDesignSystem({
  personality: "Minimal, editorial, quietly precise",
  heroEyebrow: "Kept, not worn out",
  story:
    "Aureum was built on a quiet idea: a watch should be noticed by the person wearing it first, and by everyone else second. We keep the collection small and design each reference to be kept.",
  palette: { background: "#F4F2EC", surface: "#EAE7DE", ink: "#16130E", accent: "#8A6D3B", accentInk: "#FFFFFF" },
  fonts: { headingKey: "cormorant", bodyKey: "jost" },
  typeStyle: { headingWeight: 500, headingCase: "none", headingTracking: 0.01, scale: 1.36 },
  shape: { radius: 0, buttonShape: "sharp", borderWidth: 1, shadow: "none" },
  space: { density: "airy", container: 1240 },
  layout: {
    nav: "minimal",
    hero: "statement",
    card: "minimal",
    footer: "minimal",
    imageTreatment: "editorial",
    motion: "calm",
    announcement: null,
    sectionOrder: ["hero", "collection", "story", "footer"],
  },
});

// 2 — VOLT · streetwear. Bold, expressive, near-black with an acid accent.
// Condensed display type in caps, tight grid, image-overlay cards, loud footer.
const VOLT = parseDesignSystem({
  personality: "Bold, expressive, fashion-forward",
  heroEyebrow: "Drops, not seasons",
  highlights: [
    { title: "Heavyweight, not flimsy", detail: "280gsm jersey that keeps its shape instead of going see-through." },
    { title: "Cut for movement", detail: "Dropped shoulders, boxed hem, room to actually move in it." },
    { title: "Drops, not seasons", detail: "Limited runs. When a piece is gone, it does not come back." },
  ],
  palette: { background: "#0E0E10", surface: "#17171B", ink: "#F5F5F2", accent: "#C6FF3A", accentInk: "#0E0E10" },
  fonts: { headingKey: "bebas", bodyKey: "spacegrotesk" },
  typeStyle: { headingWeight: 400, headingCase: "upper", headingTracking: 0.0, scale: 1.4 },
  shape: { radius: 2, buttonShape: "sharp", borderWidth: 2, shadow: "none" },
  space: { density: "tight", container: 1320 },
  layout: {
    nav: "bordered",
    hero: "fullbleed",
    card: "overlay",
    footer: "bold",
    imageTreatment: "duotone",
    motion: "lively",
    // Was "Free shipping worldwide · New drop friday". This file is destined to
    // be few-shot input for the generator, and a shipping promise in an exemplar
    // is a shipping promise the model will write into real merchants' stores —
    // the one thing the header above says these presets must never contain.
    announcement: "New drop friday",
    sectionOrder: ["announcement", "hero", "marquee", "collection", "highlights", "footer"],
  },
});

// 3 — LUMÈ · skincare. Warm, friendly, cream + terracotta. Soft modern serif,
// very rounded, elevated shadows, framed cards, generous and gentle.
const LUME = parseDesignSystem({
  personality: "Warm, friendly, sun-softened",
  heroEyebrow: "For reactive skin",
  story:
    "Lumè exists because most skincare talks to you as though something is wrong. We make a small number of gentle, well-considered things, and we let your skin take its time.",
  trust: [
    { title: "Fourteen days to return", detail: "Opened and half-used is fine — skin needs time to answer." },
    { title: "The whole ingredient list", detail: "Everything in the bottle is printed on the bottle, in plain language." },
    { title: "Secure checkout", detail: "Card details are encrypted in transit and never stored by us." },
    { title: "A person, not a bot", detail: "Write to us about your skin and someone here will actually write back." },
  ],
  palette: { background: "#FBF3EC", surface: "#FFFFFF", ink: "#3A2E28", accent: "#E0855B", accentInk: "#FFFFFF" },
  fonts: { headingKey: "fraunces", bodyKey: "dmsans" },
  typeStyle: { headingWeight: 600, headingCase: "none", headingTracking: -0.01, scale: 1.22 },
  shape: { radius: 22, buttonShape: "pill", borderWidth: 1, shadow: "elevated" },
  space: { density: "balanced", container: 1180 },
  layout: {
    nav: "centered",
    hero: "split",
    card: "framed",
    footer: "editorial",
    imageTreatment: "framed",
    motion: "lively",
    announcement: "New: the barrier serum",
    sectionOrder: ["announcement", "hero", "trust", "collection", "story", "newsletter", "footer"],
  },
});

export const STYLE_PRESETS: Record<string, StylePreset> = {
  aureum: { key: "aureum", label: "Aureum — luxury watches", ds: AUREUM },
  volt: { key: "volt", label: "VOLT — streetwear", ds: VOLT },
  lume: { key: "lume", label: "Lumè — skincare", ds: LUME },
};
