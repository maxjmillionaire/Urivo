import { parseDesignSystem, type StoreDesignSystem } from "./design-system";

/*
 * Pure, testable application of a conversational store edit.
 *
 * The AI proposes an EditPlan; the API re-validates it and applies it here.
 * Design changes are always re-run through parseDesignSystem() so every value is
 * clamped to a safe, coherent range — the model can suggest, but never bypass
 * the design system's guarantees (spec 6.5).
 */

export interface DesignPatch {
  name?: string;
  tagline?: string;
  personality?: string;
  background?: string;
  ink?: string;
  accent?: string;
  headingKey?: string;
  bodyKey?: string;
  radius?: number;
  buttonShape?: string;
  shadow?: string;
  borderWidth?: number;
  density?: string;
  container?: number;
  headingWeight?: number;
  headingCase?: string;
  nav?: string;
  hero?: string;
  card?: string;
  footer?: string;
  imageTreatment?: string;
  motion?: string;
  announcement?: string | null;
  sectionOrder?: string[];
}

export type ProductEdit =
  | { action: "add"; title: string; description: string; priceEUR: number }
  | { action: "update"; index: number; title?: string; description?: string; priceEUR?: number }
  | { action: "remove"; index: number };

export interface EditPlan {
  summary: string;
  design?: DesignPatch;
  products?: ProductEdit[];
  setLive?: boolean;
}

/** Apply a design patch to the current design system, re-clamping the result. */
export function applyDesignPatch(current: StoreDesignSystem, patch: DesignPatch): StoreDesignSystem {
  const raw: Record<string, unknown> = {
    personality: patch.personality ?? current.personality,
    tagline: patch.tagline ?? current.tagline,
    // Carry through the authored intelligence a palette/type tweak must not wipe:
    // the emotional journey, the creative brief and the brand story.
    brief: current.brief,
    story: current.story,
    narrative: current.narrative,
    palette: { ...current.palette },
    fonts: { ...current.fonts },
    typeStyle: { ...current.typeStyle },
    shape: { ...current.shape },
    space: { ...current.space },
    layout: { ...current.layout },
  };
  const palette = raw.palette as Record<string, unknown>;
  const fonts = raw.fonts as Record<string, unknown>;
  const typeStyle = raw.typeStyle as Record<string, unknown>;
  const shape = raw.shape as Record<string, unknown>;
  const space = raw.space as Record<string, unknown>;
  const layout = raw.layout as Record<string, unknown>;

  // Palette — when a base role changes, drop derived roles so they re-derive.
  if (patch.background) palette.background = patch.background;
  if (patch.ink) palette.ink = patch.ink;
  if (patch.accent) palette.accent = patch.accent;
  if (patch.background || patch.ink) {
    delete palette.surface;
    delete palette.muted;
    delete palette.line;
  }
  if (patch.accent) delete palette.accentInk;

  if (patch.headingKey) fonts.headingKey = patch.headingKey;
  if (patch.bodyKey) fonts.bodyKey = patch.bodyKey;

  if (patch.headingWeight !== undefined) typeStyle.headingWeight = patch.headingWeight;
  if (patch.headingCase) typeStyle.headingCase = patch.headingCase;

  if (patch.radius !== undefined) shape.radius = patch.radius;
  if (patch.buttonShape) shape.buttonShape = patch.buttonShape;
  if (patch.shadow) shape.shadow = patch.shadow;
  if (patch.borderWidth !== undefined) shape.borderWidth = patch.borderWidth;

  if (patch.density) space.density = patch.density;
  if (patch.container !== undefined) space.container = patch.container;

  if (patch.nav) layout.nav = patch.nav;
  if (patch.hero) layout.hero = patch.hero;
  if (patch.card) layout.card = patch.card;
  if (patch.footer) layout.footer = patch.footer;
  if (patch.imageTreatment) layout.imageTreatment = patch.imageTreatment;
  if (patch.motion) layout.motion = patch.motion;
  if (patch.announcement !== undefined) layout.announcement = patch.announcement;
  if (patch.sectionOrder) layout.sectionOrder = patch.sectionOrder;

  return parseDesignSystem(raw);
}

export interface ProductRow {
  id: string;
  title: string;
  description: string;
  price_eur: number;
  position: number;
}

export interface ProductMutations {
  inserts: { title: string; description: string; price_eur: number; position: number }[];
  updates: { id: string; title?: string; description?: string; price_eur?: number }[];
  deletes: string[];
}

/**
 * Resolve product edits (referenced by 0-based index into the current, ordered
 * list) into concrete insert/update/delete mutations. Out-of-range indices are
 * ignored so a stale plan can never corrupt the catalogue.
 */
export function resolveProductEdits(current: ProductRow[], edits: ProductEdit[]): ProductMutations {
  const mut: ProductMutations = { inserts: [], updates: [], deletes: [] };
  let nextPos = current.reduce((m, p) => Math.max(m, p.position), -1) + 1;

  for (const e of edits) {
    if (e.action === "add") {
      mut.inserts.push({
        title: e.title,
        description: e.description,
        price_eur: e.priceEUR,
        position: nextPos++,
      });
    } else if (e.action === "update") {
      const row = current[e.index];
      if (!row) continue;
      const u: { id: string; title?: string; description?: string; price_eur?: number } = { id: row.id };
      if (e.title !== undefined) u.title = e.title;
      if (e.description !== undefined) u.description = e.description;
      if (e.priceEUR !== undefined) u.price_eur = e.priceEUR;
      mut.updates.push(u);
    } else if (e.action === "remove") {
      const row = current[e.index];
      if (row) mut.deletes.push(row.id);
    }
  }
  return mut;
}
