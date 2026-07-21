import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import {
  parseDesignSystem,
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
  HEADING_CASES,
  SECTION_KEYS,
  type StoreDesignSystem,
} from "@/lib/storefront/design-system";
import { AI_INPUT_BUDGET, clampText } from "./limits";
import type { TokenUsage } from "@/lib/finance/cost-model";

/*
 * Store generation orchestrator (specs 1, 6.3, 6.5).
 *
 * The AI is a CREATIVE DIRECTOR, not a template filler. From the founder's
 * prompt it designs a complete, original design system — layout archetype, type
 * pairing, colour, shape, motion, section order, personality — plus brand and
 * catalogue. Two prompts must yield two stores that look like the work of two
 * different world-class agencies; the only constant is quality.
 *
 * This module is the ONLY place business logic touches the AI SDK (spec 6.9).
 * Everything the model returns is untrusted and re-validated (spec 6.3 §23):
 * the schema constrains it, and parseDesignSystem() clamps it again.
 */

export const STORE_GENERATOR_MODEL = "claude-opus-4-8";
export const STORE_GENERATOR_PROMPT_VERSION = "v2";

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX);
const e = <T extends readonly string[]>(vals: T) =>
  z.enum(vals as unknown as [string, ...string[]]);

const DesignSchema = z.object({
  personality: z.string().min(3).max(80),
  // background/ink/accent are essential; the rest are derived when omitted so a
  // slightly incomplete payload still yields a coherent, on-brand palette.
  palette: z.object({
    background: hex,
    ink: hex,
    accent: hex,
    surface: hex.nullish(),
    muted: hex.nullish(),
    line: hex.nullish(),
    accentInk: hex.nullish(),
  }),
  fonts: z.object({ headingKey: e(FONT_KEYS), bodyKey: e(FONT_KEYS) }),
  typeStyle: z.object({
    headingWeight: z.number().min(300).max(900),
    headingCase: e(HEADING_CASES),
    headingTracking: z.number().min(-0.04).max(0.3),
    scale: z.number().min(1.12).max(1.4),
  }),
  shape: z.object({
    radius: z.number().min(0).max(32),
    buttonShape: e(BUTTON_SHAPES),
    borderWidth: z.number().min(0).max(3),
    shadow: e(SHADOW_LEVELS),
  }),
  space: z.object({ density: e(DENSITIES), container: z.number().min(1040).max(1440) }),
  layout: z.object({
    nav: e(NAV_VARIANTS),
    hero: e(HERO_VARIANTS),
    card: e(CARD_VARIANTS),
    footer: e(FOOTER_VARIANTS),
    imageTreatment: e(IMAGE_TREATMENTS),
    motion: e(MOTION_LEVELS),
    announcement: z.string().max(120).nullable(),
    sectionOrder: e(SECTION_KEYS).array().min(3).max(9),
  }),
});

const GenerationSchema = z.object({
  brand: z.object({
    name: z.string().min(2).max(60),
    tagline: z.string().min(4).max(120),
  }),
  design: DesignSchema,
  products: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().min(10).max(400),
        priceEUR: z.number().positive().max(100000),
      }),
    )
    .min(3)
    .max(8),
});

export interface GeneratedStore {
  brand: { name: string; tagline: string };
  designSystem: StoreDesignSystem;
  products: { title: string; description: string; priceEUR: number }[];
  /** Real provider token usage, for the cost ledger. */
  usage: TokenUsage;
}

const SYSTEM_PROMPT = `You are the Creative Director and copywriter for Urivo, a premium AI commerce platform. From a founder's idea you design a COMPLETE, ORIGINAL storefront: a brand, a curated catalogue, and — most importantly — a full design system unique to this brand.

Think like a world-class creative agency, never like a template engine. Study why the best modern commerce sites convert — strong visual hierarchy, premium branding, considered product presentation, trust, compelling CTAs, clean layouts, beautiful typography, generous spacing, tasteful motion — and apply those PRINCIPLES to invent something new. Never copy an existing brand or store.

The prompt defines the creative direction. A richer prompt earns a bolder, more specific store. Let the brand's world dictate every decision, so two different briefs produce two stores that look like the work of two different agencies. Only quality is constant.

Make deliberate, COHERENT choices across all of these — and make them differ meaningfully between briefs:
- personality: a short phrase capturing the art direction (e.g. "Minimal, editorial, precise" / "Bold, expressive, fashion-forward" / "Warm, friendly, sun-softened" / "Sleek, futuristic, exact").
- palette: seven roles as #RRGGBB. background + ink must have strong contrast (text always readable). surface is a near-background panel tone; muted is secondary text; line is a hairline; accent is the one brand colour; accentInk is readable text on the accent. Avoid pure #000/#fff. A dark canvas is welcome when the brand calls for it.
- fonts.headingKey / bodyKey — choose from: ${FONT_KEYS.join(", ")}. Pair with intent (elegant serif for luxury; condensed display like "bebas" for streetwear; soft modern serif like "fraunces" for warm brands; geometric/techy sans like "spacegrotesk"/"sora" for modern tech; "ibmmono" for a technical accent). Heading and body should differ.
- typeStyle: headingWeight (300–900), headingCase ("none" or "upper"), headingTracking (-0.04 tight to 0.3 wide, em), scale (1.12 restrained → 1.4 dramatic display).
- shape: radius (0 sharp → 32 very rounded), buttonShape ("sharp" | "soft" | "pill"), borderWidth (0–3), shadow ("none" | "soft" | "elevated"). Match the personality — minimal luxury tends sharp + shadowless; friendly brands round + soft-shadowed; streetwear sharp + hard.
- space: density ("airy" | "balanced" | "tight"), container (1040 intimate → 1440 wide).
- layout: nav (${NAV_VARIANTS.join(" | ")}), hero (${HERO_VARIANTS.join(" | ")}), card (${CARD_VARIANTS.join(" | ")}), footer (${FOOTER_VARIANTS.join(" | ")}), imageTreatment (${IMAGE_TREATMENTS.join(" | ")}), motion ("calm" | "lively"), announcement (a short top-bar line, or null), sectionOrder (an ordered subset of: ${SECTION_KEYS.join(", ")}; always include "hero" and "collection"; add "announcement" first only if you set one; choose the sections that suit the brand).

Copy standards:
- Premium and specific — write as an experienced founder or luxury copywriter. Never generic filler.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "In today's digital world", "Elevate", "Unleash".
- Brand name: inventable and ownable — not a dictionary word, not the founder's prompt echoed back.
- Tagline: editorial, confident, short, no exclamation marks, no hype.
- Product descriptions: concrete and sensory — materials, use, feeling. 1–2 sentences. Never a list of adjectives.
- Prices realistic for the positioning, in EUR. Produce 3–8 products forming one focused, coherent collection.`;

export interface StoreGenerationInput {
  prompt: string;
}

/**
 * Generate a validated brand + design system + catalogue from a founder prompt.
 * Throws on missing configuration, provider failure, or invalid AI output.
 */
export async function generateStore(input: StoreGenerationInput): Promise<GeneratedStore> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: STORE_GENERATOR_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(GenerationSchema),
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Design a completely original storefront for this business. Commit fully to a design language that fits it:\n\n${clampText(input.prompt.trim(), AI_INPUT_BUDGET.promptChars)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");

  const result = GenerationSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");

  // Second gate: clamp/normalise the design system defensively (spec 6.5).
  const designSystem = parseDesignSystem({
    ...result.data.design,
    tagline: result.data.brand.tagline,
  });

  return {
    brand: result.data.brand,
    designSystem,
    products: result.data.products,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
