import * as z from "zod/v4";
import {
  FONT_KEYS,
  NAV_VARIANTS,
  HERO_VARIANTS,
  CARD_VARIANTS,
  FOOTER_VARIANTS,
  BUTTON_SHAPES,
  SHADOW_LEVELS,
  IMAGE_TREATMENTS,
  MOTION_LEVELS,
  DENSITIES,
  SECTION_KEYS,
} from "@/lib/storefront/design-system";

/*
 * The shape of a proposed store change.
 *
 * Extracted so there is exactly ONE definition of what Urivo may propose,
 * shared by the streaming assistant (which offers it as a tool) and the
 * structured editor endpoint. Two copies would drift, and the copy that drifted
 * would be the one deciding what gets written to a merchant's live store.
 *
 * Pure — no server-only imports — so it is unit-testable and usable from either
 * side of the AI boundary.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const en = <T extends readonly string[]>(v: T) => z.enum(v as unknown as [string, ...string[]]);

export const DesignPatchSchema = z
  .object({
    name: z.string().min(2).max(60).optional(),
    tagline: z.string().min(2).max(160).optional(),
    personality: z.string().min(3).max(80).optional(),
    background: hex.optional(),
    ink: hex.optional(),
    accent: hex.optional(),
    headingKey: en(FONT_KEYS).optional(),
    bodyKey: en(FONT_KEYS).optional(),
    radius: z.number().min(0).max(32).optional(),
    buttonShape: en(BUTTON_SHAPES).optional(),
    shadow: en(SHADOW_LEVELS).optional(),
    density: en(DENSITIES).optional(),
    nav: en(NAV_VARIANTS).optional(),
    hero: en(HERO_VARIANTS).optional(),
    card: en(CARD_VARIANTS).optional(),
    footer: en(FOOTER_VARIANTS).optional(),
    imageTreatment: en(IMAGE_TREATMENTS).optional(),
    motion: en(MOTION_LEVELS).optional(),
    announcement: z.string().max(120).nullable().optional(),
    sectionOrder: en(SECTION_KEYS).array().optional(),
  })
  .optional();

export const ProductEditSchema = z.object({
  action: z.enum(["add", "update", "remove"]),
  index: z.number().int().min(0).optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(400).optional(),
  priceEUR: z.number().positive().max(100000).optional(),
});

/** A change the founder can accept. Never applied without their approval. */
export const AIEditPlanSchema = z.object({
  summary: z.string().min(3).max(200),
  design: DesignPatchSchema,
  products: ProductEditSchema.array().max(8).optional(),
  setLive: z.boolean().optional(),
});

export type AIEditPlan = z.infer<typeof AIEditPlanSchema>;
