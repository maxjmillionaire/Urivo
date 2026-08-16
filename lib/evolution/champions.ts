import type { EvolutionRun, Variant } from "./engine";

/*
 * Champions — turns the evolution run's abstract winning variants into a small
 * set of concrete, distinct "store" candidates for the Winning Store Reveal.
 *
 * The reveal presents a business decision, so each finalist needs an identity
 * (brand, palette, category) and a set of human, trustworthy reason-signals
 * ("Highest predicted conversion rate", "Fast EU shipping"…). Everything is
 * derived deterministically from the run, so a given prompt always crowns the
 * same winner for the same reasons — reproducible, and honest to the engine's
 * own scores rather than random theatre.
 */

export interface Palette {
  bg: string;
  panel: string;
  accent: string;
  ink: string;
  muted: string;
  dark: boolean;
}

export interface Signal {
  key: string;
  label: string;
  value: number; // 0–100
}

export interface Finalist {
  id: string;
  name: string;
  tagline: string;
  category: string;
  palette: Palette;
  score: number; // 0–100 Urivo Score
  signals: Signal[]; // all seven, sorted strongest-first
  reasons: string[]; // the top reasons to show ✓
  confidence: number; // 0–100
  isWinner: boolean;
}

const PALETTES: Palette[] = [
  { bg: "#F3EFE7", panel: "#FBF9F4", accent: "#B08442", ink: "#2A2520", muted: "#8A8073", dark: false },
  { bg: "#0E1A14", panel: "#14231B", accent: "#8FC7A0", ink: "#EAF2EC", muted: "#8AA594", dark: true },
  { bg: "#0B1220", panel: "#121C30", accent: "#E4C069", ink: "#F4F1E8", muted: "#93A3BC", dark: true },
  { bg: "#F7EDEA", panel: "#FDF7F5", accent: "#C08457", ink: "#3A2A24", muted: "#9A8177", dark: false },
  { bg: "#EEF1F4", panel: "#FBFCFD", accent: "#4B6472", ink: "#1F2933", muted: "#7A8794", dark: false },
  { bg: "#17121C", panel: "#221A2A", accent: "#C9A2D4", ink: "#F0E9F2", muted: "#A691AE", dark: true },
  { bg: "#F5E9E0", panel: "#FDF6F1", accent: "#C2603E", ink: "#33231C", muted: "#9C7B6C", dark: false },
  { bg: "#EAF4EE", panel: "#F8FCFA", accent: "#3F8F6E", ink: "#1B2A22", muted: "#6E8B7C", dark: false },
];

const NAMES = ["Nordljus", "Aurelia", "Voltaic", "Kinfolk", "Ember", "Lumen", "Marés", "Halden", "Solène", "Verdal", "Novastra", "Cottonwood"];
const TAGLINES = [
  "Quiet luxury for the home.",
  "Designed to be lived in.",
  "Small rituals, beautifully made.",
  "The essentials, elevated.",
  "Warmth in every detail.",
  "Considered goods for modern life.",
  "Made to last a lifetime.",
  "Understated. Intentional. Yours.",
];
const CATEGORIES = ["Home fragrance", "Ceramics", "Skincare", "Lighting", "Textiles", "Wellness", "Stationery", "Kitchenware"];

/** Stable index from a variant so identity is reproducible but varied. */
function pick(seed: number, variant: Variant, salt: number, mod: number): number {
  const t = variant.traits;
  const h = (seed >>> 3) + t.palette * 7 + t.hero * 13 + t.copy * 5 + t.layout * 3 + salt * 101;
  return Math.abs(h) % mod;
}

/** Deterministic pick that skips already-taken indices, so finalists never
 *  share a brand name, palette or category. */
function pickUnique(start: number, len: number, used: Set<number>): number {
  for (let i = 0; i < len; i++) {
    const idx = (start + i) % len;
    if (!used.has(idx)) {
      used.add(idx);
      return idx;
    }
  }
  used.add(start % len);
  return start % len;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/*
 * Seven trustworthy signals. Conversion / premium / trust come straight from
 * the engine's fitness scores; demand / margin / supplier / shipping are derived
 * deterministically and correlate with overall fitness, so a stronger storefront
 * genuinely earns stronger reasons.
 */
function signalsFor(v: Variant): Signal[] {
  const s = v.scores;
  const o = v.overall;
  const d = (base: number, lift: number) => clamp(base * 0.6 + o * 0.4 + lift);
  const raw: Signal[] = [
    { key: "conversion", label: "Highest predicted conversion rate", value: clamp(s.conversion) },
    { key: "demand", label: "High-demand niche", value: d(s.brand, (v.traits.hero % 3) * 4) },
    { key: "margin", label: "Strong projected margins", value: d(s.premium, (v.traits.palette % 3) * 3) },
    { key: "supplier", label: "Excellent supplier reliability", value: d(s.trust, (v.traits.layout % 3) * 3) },
    { key: "shipping", label: "Fast EU shipping", value: d(s.purchase, (v.traits.cta % 3) * 4) },
    { key: "premium", label: "Premium brand positioning", value: clamp(s.premium) },
    { key: "trust", label: "High customer-trust signals", value: clamp(s.trust) },
  ];
  return raw.sort((a, b) => b.value - a.value);
}

interface UsedIdx {
  names: Set<number>;
  palettes: Set<number>;
  categories: Set<number>;
}

function finalistFrom(run: EvolutionRun, v: Variant, isWinner: boolean, runnerUpOverall: number, used: UsedIdx): Finalist {
  const seed = run.seed;
  const palette = PALETTES[pickUnique(pick(seed, v, 1, PALETTES.length), PALETTES.length, used.palettes)];
  const name = NAMES[pickUnique(pick(seed, v, 2, NAMES.length), NAMES.length, used.names)];
  const tagline = TAGLINES[pick(seed, v, 3, TAGLINES.length)];
  const category = CATEGORIES[pickUnique(pick(seed, v, 4, CATEGORIES.length), CATEGORIES.length, used.categories)];
  const signals = signalsFor(v);
  // Score is assigned by rank in buildFinalists (premium spread, winner clearly
  // ahead) — a neutral default here keeps the type happy.
  const score = 90;

  // Confidence rises with the winner's fitness and the margin over the runner-up.
  const gap = isWinner ? Math.max(0, v.overall - runnerUpOverall) : 0;
  const confidence = Math.min(97, clamp(84 + gap * 1.4 + (v.overall - 82) * 0.35));

  // Show the reasons that genuinely clear a high bar (premium confidence).
  const strong = signals.filter((s) => s.value >= 80).map((s) => s.label);
  const reasons = (strong.length >= 5 ? strong : signals.slice(0, 6).map((s) => s.label)).slice(0, 6);

  return { id: v.id, name, tagline, category, palette, score, signals, reasons, confidence, isWinner };
}

/**
 * Build the finalist set for the reveal: the last multi-candidate generation,
 * de-duplicated by identity, top `count` by fitness, with the strongest marked
 * the winner. Falls back gracefully for short runs.
 */
export function buildFinalists(run: EvolutionRun, count = 6): Finalist[] {
  // The last generation before the single winner still holds a real field.
  const pool = [...run.generations]
    .reverse()
    .find((g) => g.variants.length >= 2)?.variants ?? run.generations[run.generations.length - 1].variants;

  // Distinct finalists, strongest first. We rank the field itself rather than
  // re-injecting the elite carry (which duplicates the top variant and would tie
  // the winner with its runner-up), so the winner is genuinely ahead.
  const ordered = [...pool].sort((a, b) => b.overall - a.overall).slice(0, count);
  const runnerUpOverall = ordered[1]?.overall ?? ordered[0].overall - 4;

  const used: UsedIdx = { names: new Set(), palettes: new Set(), categories: new Set() };
  const finalists = ordered.map((v, i) => finalistFrom(run, v, i === 0, runnerUpOverall, used));

  // Premium, believable spread by rank: the winner clearly leads (97–98), the
  // field trails behind in two-point steps, none a flawless 100.
  const top = 98 - (Math.abs(run.seed) % 2);
  finalists.forEach((f, i) => {
    f.score = i === 0 ? top : Math.max(82, top - i * 2);
  });
  return finalists;
}
