/*
 * Evolution engine (spec 6.6). Simulates generations of storefront variants
 * that compete on a fitness score; the bottom half dies each generation and
 * the survivors breed mutated children until one winner remains.
 *
 * Deterministic and seedable so a run is reproducible and free — the "AI
 * laboratory" experience without 100 live model calls per run. The fitness
 * scores are a heuristic model (real per-variant AI scoring is a scale/cost
 * decision for later); the experience of watching intelligence converge is
 * the same.
 */

export interface Scores {
  conversion: number;
  trust: number;
  readability: number;
  balance: number;
  premium: number;
  brand: number;
  purchase: number;
}

export interface Variant {
  id: string;
  gen: number;
  parentId: string | null;
  traits: Traits;
  scores: Scores;
  overall: number;
  survived: boolean;
}

export interface Traits {
  layout: number; // index into a conceptual option set
  palette: number;
  typography: number;
  hero: number;
  cta: number;
  copy: number;
}

export interface Generation {
  index: number;
  variants: Variant[];
  best: Variant;
  commentary: string;
}

export interface EvolutionRun {
  seed: number;
  generations: Generation[];
  winner: Variant;
}

const GEN_SIZES = [100, 50, 25, 12, 6, 1];
const TRAIT_KEYS: (keyof Traits)[] = ["layout", "palette", "typography", "hero", "cta", "copy"];
const TRAIT_LABELS: Record<keyof Traits, string> = {
  layout: "Layout",
  palette: "Palette",
  typography: "Typography",
  hero: "Hero",
  cta: "CTA",
  copy: "Copy",
};

// Deterministic RNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Fitness rises with generation depth (survivors improve) plus per-trait
 *  harmony and a little noise, so the field converges without being flat. */
function score(traits: Traits, gen: number, rand: () => number): { scores: Scores; overall: number } {
  const depthLift = gen * 5;
  const harmony =
    ((traits.palette + traits.typography) % 5) * 3 +
    ((traits.hero + traits.cta) % 4) * 4 +
    ((traits.layout + traits.copy) % 6) * 2;
  const base = 50 + depthLift + harmony;
  const jitter = () => (rand() - 0.5) * 16;

  const scores: Scores = {
    conversion: clamp(base + jitter() + traits.cta * 2),
    trust: clamp(base + jitter() + traits.hero * 2),
    readability: clamp(base + jitter() + traits.typography * 2),
    balance: clamp(base + jitter() + traits.layout * 2),
    premium: clamp(base + jitter() + traits.palette * 2),
    brand: clamp(base + jitter() + traits.copy * 2),
    purchase: clamp(base + jitter() + traits.cta + traits.hero),
  };
  const overall = clamp(
    (scores.conversion * 0.25 +
      scores.trust * 0.15 +
      scores.readability * 0.12 +
      scores.balance * 0.12 +
      scores.premium * 0.14 +
      scores.brand * 0.12 +
      scores.purchase * 0.1),
  );
  return { scores, overall };
}

function randomTraits(rand: () => number): Traits {
  return {
    layout: Math.floor(rand() * 8),
    palette: Math.floor(rand() * 8),
    typography: Math.floor(rand() * 6),
    hero: Math.floor(rand() * 6),
    cta: Math.floor(rand() * 6),
    copy: Math.floor(rand() * 6),
  };
}

function mutate(parent: Traits, rand: () => number): { traits: Traits; changed: keyof Traits } {
  const changed = TRAIT_KEYS[Math.floor(rand() * TRAIT_KEYS.length)];
  const caps: Record<keyof Traits, number> = {
    layout: 8, palette: 8, typography: 6, hero: 6, cta: 6, copy: 6,
  };
  const nudge = rand() < 0.5 ? 1 : -1;
  const next = { ...parent };
  next[changed] = (parent[changed] + nudge + caps[changed]) % caps[changed];
  return { traits: next, changed };
}

const COMMENTARY: Record<keyof Traits, string[]> = {
  hero: ["Hero rebuilt for trust", "Hero simplified", "Hero image warmed"],
  cta: ["CTA enlarged", "CTA colour shifted for contrast", "CTA copy sharpened"],
  typography: ["Typography tightened", "Headline weight rebalanced", "Reading rhythm improved"],
  palette: ["Palette pushed more premium", "Contrast raised", "Accent restrained"],
  layout: ["Layout resequenced", "Whitespace increased", "Navigation simplified"],
  copy: ["Headline rewritten", "Copy made more concrete", "Brand hierarchy improved"],
};

export function runEvolution(seedInput: string | number): EvolutionRun {
  const seed = typeof seedInput === "number" ? seedInput : hashSeed(seedInput);
  const rand = rng(seed);
  const generations: Generation[] = [];
  let lastChanged: keyof Traits = "hero";

  // Generation 0 — random field.
  let variants: Variant[] = Array.from({ length: GEN_SIZES[0] }, (_, i) => {
    const traits = randomTraits(rand);
    const { scores, overall } = score(traits, 0, rand);
    return { id: `g0-${i}`, gen: 0, parentId: null, traits, scores, overall, survived: false };
  });

  for (let g = 0; g < GEN_SIZES.length; g++) {
    const size = GEN_SIZES[g];
    variants = variants.slice(0, size).sort((a, b) => b.overall - a.overall);

    const best = variants[0];
    // Mark survivors: top half (or the single winner in the last generation).
    const survivorCount = g === GEN_SIZES.length - 1 ? 1 : Math.max(1, Math.floor(size / 2));
    variants.forEach((v, i) => (v.survived = i < survivorCount));

    const changedKey = g === 0 ? "hero" : lastChanged;
    const commentary =
      g === 0
        ? "Generation 0: one hundred completely different storefronts."
        : `${COMMENTARY[changedKey][seed % 3]} — top performer now scores ${best.overall.toFixed(1)}.`;

    generations.push({ index: g, variants: [...variants], best, commentary });

    if (g === GEN_SIZES.length - 1) break;

    // Breed the next generation from survivors.
    const survivors = variants.filter((v) => v.survived);
    const nextSize = GEN_SIZES[g + 1];
    const children: Variant[] = [];
    let lc: keyof Traits = "hero";
    for (let i = 0; i < nextSize; i++) {
      // Elitism: the champion carries forward unchanged so the winner never
      // regresses below the best already discovered (spec 6.6: high performers
      // survive).
      if (i === 0) {
        children.push({
          ...best,
          id: `g${g + 1}-0`,
          gen: g + 1,
          parentId: best.id,
          survived: false,
        });
        continue;
      }
      const parent = survivors[i % survivors.length];
      const { traits, changed } = mutate(parent.traits, rand);
      lc = changed;
      const { scores, overall } = score(traits, g + 1, rand);
      children.push({
        id: `g${g + 1}-${i}`,
        gen: g + 1,
        parentId: parent.id,
        traits,
        scores,
        overall,
        survived: false,
      });
    }
    lastChanged = lc;
    variants = children;
  }

  const winner = generations[generations.length - 1].best;
  return { seed, generations, winner };
}

export { GEN_SIZES, TRAIT_LABELS };
