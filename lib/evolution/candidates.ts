import type { Variant } from "./engine";

/*
 * Maps an evolution Variant to a displayable store concept for the generation
 * cinema — an invented brand name, a curated premium palette and an editorial
 * tagline. Deterministic (driven by the variant's trait indices) so the
 * competing cards are stable and coherent, never random noise.
 *
 * These are the *competing* candidates shown during exploration. The final
 * winning reveal uses the real AI-generated store, not one of these.
 */

export interface Candidate {
  id: string;
  name: string;
  palette: [string, string, string]; // background, structure, accent
  tagline: string;
  score: number;
}

const PALETTES: [string, string, string][] = [
  ["#F4F1EA", "#2C3239", "#A68A64"],
  ["#F2EFE9", "#242A33", "#C9A24B"],
  ["#F1ECE4", "#1C1B18", "#B89A5E"],
  ["#F3EBE7", "#3B2E2A", "#B07A5A"],
  ["#ECEEF0", "#263038", "#7C97A8"],
  ["#EFEAF2", "#2A2431", "#8A6BA8"],
  ["#F0F1F4", "#1B2A3A", "#9DB4C8"],
  ["#F4EDE4", "#3A2418", "#C0764A"],
];

const PREFIX = ["Aur", "Nord", "Vel", "Lum", "Ves", "Sol", "Mira", "Cael", "Ora", "Ryn", "Fjor", "Isa", "Kaide", "Ode", "Vayl", "Sena"];
const SUFFIX = ["a", "o", "is", "el", "ora", "une", "ia", "yn", "eau", "en", "ve", "is"];
const TAGLINES = [
  "Designed with intention",
  "Considered by nature",
  "Quiet luxury, every day",
  "Made to be kept",
  "For a considered life",
  "The art of less",
  "Crafted in calm",
  "Enduring by design",
  "Softly, deliberately",
  "Built to feel inevitable",
];

export function describeVariant(v: Variant): Candidate {
  const name =
    PREFIX[(v.traits.copy * 3 + v.traits.typography) % PREFIX.length] +
    SUFFIX[(v.traits.layout + v.traits.hero) % SUFFIX.length];
  const palette = PALETTES[v.traits.palette % PALETTES.length];
  const tagline = TAGLINES[(v.traits.hero * 2 + v.traits.cta) % TAGLINES.length];
  return { id: v.id, name, palette, tagline, score: v.overall };
}
