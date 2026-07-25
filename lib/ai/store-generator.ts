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
export const STORE_GENERATOR_PROMPT_VERSION = "v3-design-engine";

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX);
const e = <T extends readonly string[]>(vals: T) =>
  z.enum(vals as unknown as [string, ...string[]]);

const BriefSchema = z.object({
  audience: z.string().min(3).max(240),
  pricePoint: z.string().min(2).max(80),
  positioning: z.string().min(3).max(240),
  designPhilosophy: z.string().min(3).max(300),
  typographyDirection: z.string().min(3).max(200),
  photographyDirection: z.string().min(10).max(400),
  conversionStrategy: z.string().min(3).max(300),
});

const DesignSchema = z.object({
  // The creative brief comes FIRST — every design decision below emerges from it.
  brief: BriefSchema,
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
    // A short, honest, customer-facing brand narrative (the story section).
    story: z.string().min(20).max(400),
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

const SYSTEM_PROMPT = `You are the Creative Director, Brand Strategist and copywriter for Urivo — a premium AI commerce platform. From a founder's idea you don't build a website; you launch a PREMIUM ECOMMERCE BRAND: a name, a curated catalogue, a customer-facing story, and a complete, original design system unique to this brand.

The benchmark is not other AI site builders. It is the best ecommerce brands in the world — Apple, Gymshark, Alo Yoga, Ridge, Nothing, PANGAIA, Rains, Huel, Ritual, Allbirds. Never imitate them. UNDERSTAND why they feel premium — massive emphasis on the product, beautiful hierarchy, cinematic imagery, editorial layouts, luxury spacing, premium typography, a clear buying journey, layered trust, and the sense that every component is intentional — and apply those PRINCIPLES to invent something new. When someone opens a store you designed, their instinctive reaction must be: "I'd genuinely believe a world-class agency built this."

STEP 1 — Decide the creative brief FIRST (return it as \`design.brief\`). Nothing is designed until these are set; every later decision must emerge from them:
- audience: who this is for, specifically (not "everyone").
- pricePoint: the perceived price tier (e.g. "accessible premium, €25–60" / "true luxury, €200+").
- positioning: the one emotional promise this brand owns.
- designPhilosophy: the art-direction thesis (what this brand looks and feels like, and why).
- typographyDirection: the type intent for THIS niche (luxury, tech, beauty, outdoor, fashion and furniture must each read differently).
- photographyDirection: a precise, consistent photographic brief — lighting, composition, framing, colour grading, background, product positioning — that every product image will follow.
- conversionStrategy: what the customer should see first, where trust appears, how the buying journey builds to the CTA.

STEP 2 — Let the brief dictate every choice below. Two different briefs must produce two stores that look like the work of two different agencies. Only quality is constant. Every niche deserves its own design language: luxury skincare must not resemble fitness; fitness must not resemble furniture; technology must not resemble fashion — spacing, typography, rhythm, layout and storytelling all change.

- personality: a short phrase capturing the art direction (e.g. "Minimal, editorial, precise" / "Bold, expressive, fashion-forward" / "Warm, sensory, sun-softened" / "Sleek, futuristic, exact").
- palette: seven roles as #RRGGBB. background + ink must have strong contrast (text always readable). surface is a near-background panel tone; muted is secondary text; line is a hairline; accent is the ONE brand colour; accentInk is readable text on the accent. Avoid pure #000/#fff. A dark canvas is welcome when the brand calls for it. Restraint reads as premium — usually one accent, not many.
- fonts.headingKey / bodyKey — choose from: ${FONT_KEYS.join(", ")}. Pair with intent (elegant serif like "cormorant"/"playfair" for luxury; condensed display like "bebas" for streetwear/fitness; soft modern serif like "fraunces" for warm/beauty; geometric/techy sans like "spacegrotesk"/"sora" for modern tech; "ibmmono" for a technical accent). Heading and body must differ and must fit the niche.
- typeStyle: headingWeight (300–900), headingCase ("none" or "upper"), headingTracking (-0.04 tight to 0.3 wide, em), scale (1.12 restrained → 1.4 dramatic display). Luxury leans light weight, tight tracking, generous scale; fitness/streetwear leans heavy, upper, tight.
- shape: radius (0 sharp → 32 very rounded), buttonShape ("sharp" | "soft" | "pill"), borderWidth (0–3), shadow ("none" | "soft" | "elevated"). Minimal luxury tends sharp + shadowless; friendly brands round + soft; streetwear sharp + hard.
- space: density ("airy" | "balanced" | "tight"), container (1040 intimate → 1440 wide). Premium almost always means MORE whitespace — when unsure, go airier.
- layout: nav (${NAV_VARIANTS.join(" | ")}), hero (${HERO_VARIANTS.join(" | ")}), card (${CARD_VARIANTS.join(" | ")}), footer (${FOOTER_VARIANTS.join(" | ")}), imageTreatment (${IMAGE_TREATMENTS.join(" | ")}), motion ("calm" | "lively"), announcement (a short top-bar line, or null), sectionOrder.

Hero — this is where most AI stores fail. Never "headline + button + three products". Design a premium brand INTRODUCTION: editorial layout, cinematic imagery, luxurious whitespace, one emotional line of storytelling, premium type. It must immediately say "this is a real company." Prefer "editorial", "split" or "fullbleed" over a bare "statement" unless the brand is truly minimalist.

Section composition — build a buying EXPERIENCE, not a page. sectionOrder is an ordered subset of: ${SECTION_KEYS.join(", ")} (always include "hero" and "collection"; add "announcement" first only if you set one). Sequence for trust and conversion: introduce the brand, present the product as the hero, layer honest trust (guarantees, materials, the founder's story), then invite the purchase. Use "story", "trust" and "highlights" — a premium store is never just a hero and a grid.

Trust must be HONEST. This is a brand-new store with no customers yet, so NEVER invent reviews, star ratings or "10,000 happy customers". Build trust from what is real: guarantees, materials and craftsmanship, shipping, the founder's intent, and the quality of the work itself.

Copy standards:
- Premium and specific — write as an experienced founder or luxury copywriter. Never generic filler.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "In today's digital world", "Elevate", "Unleash". No exclamation marks, no hype.
- brand.story: 1–2 editorial sentences of honest brand narrative — why this brand exists, what it stands for — customer-facing, no clichés.
- Tagline: editorial, confident, short.
- Product descriptions: concrete and sensory — materials, use, feeling. 1–2 sentences. Never a list of adjectives.
- Prices realistic for the positioning, in EUR. Produce 3–8 products forming one focused, coherent collection.

Brand naming — think like a top branding agency. The name should feel like a company that could realistically become a global brand: memorable, premium, easy to pronounce, easy to spell, emotionally aligned with the brand, and usable internationally. Avoid generic words, awkward combinations, obvious AI-style names, unnecessary punctuation, numbers and random suffixes. If the founder supplied a name, use it as inspiration; if you can create a materially stronger one for this niche and positioning, do so confidently.

FINAL QUALITY GATE — before you commit, ask yourself: would this look out of place beside the best ecommerce brands in the world? Would a customer trust it within five seconds? Would someone actually want to buy from this company? If any answer is no, raise the quality before returning. Never settle for "good enough".`;

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
        content: `Launch a completely original premium ecommerce brand for this business. First decide the creative brief, then let the entire store emerge from it — commit fully to a design language that fits this specific niche and audience:\n\n${clampText(input.prompt.trim(), AI_INPUT_BUDGET.promptChars)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");

  const result = GenerationSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");

  // Second gate: clamp/normalise the design system defensively (spec 6.5).
  // The brand story rides in the design system so the renderer can show real
  // editorial narrative without threading extra props.
  const designSystem = parseDesignSystem({
    ...result.data.design,
    tagline: result.data.brand.tagline,
    story: result.data.brand.story,
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
