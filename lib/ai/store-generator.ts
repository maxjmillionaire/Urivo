import "server-only";
import { modelFor } from "./models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import {
  parseDesignSystem,
  FONT_KEYS,
  NAV_VARIANTS,
  CARD_VARIANTS,
  FOOTER_VARIANTS,
  BUTTON_SHAPES,
  SHADOW_LEVELS,
  IMAGE_TREATMENTS,
  MOTION_LEVELS,
  DENSITIES,
  HEADING_CASES,
  type StoreDesignSystem,
} from "@/lib/storefront/design-system";
import { BLOCK_KINDS } from "@/lib/storefront/narrative";
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

export const STORE_GENERATOR_MODEL = modelFor("storeGeneration");
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

// One authored beat of the emotional journey. Fields are REQUIRED (the model
// fills only the ones its `kind` needs and leaves the rest empty / -1) to keep
// the structured-output schema under its union-parameter limit; parseNarrative
// then validates strictly per kind and drops anything empty or malformed.
// Length/shape constraints are intentionally omitted here: they bloat the
// structured-output grammar. parseNarrative clamps every field and drops empty
// or malformed beats, so validation lives there, not in the wire schema.
const NarrativeItem = z.object({
  title: z.string(),
  detail: z.string(),
  label: z.string(),
  q: z.string(),
  a: z.string(),
});
const NarrativeBlockSchema = z.object({
  kind: e(BLOCK_KINDS),
  intent: z.string(),
  emphasis: z.enum(["calm", "bold"]),
  eyebrow: z.string(),
  headline: z.string(),
  subhead: z.string(),
  body: z.string(),
  title: z.string(),
  text: z.string(),
  attribution: z.string(),
  ctaLabel: z.string(),
  heroProductIndex: z.number().int(), // -1 when idea-led
  productIndex: z.number().int(), // -1 when unused
  phrases: z.array(z.string()),
  benefits: z.array(z.string()),
  items: z.array(NarrativeItem),
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
    surface: hex,
    muted: hex,
    line: hex,
    accentInk: hex,
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
  // Authored proof. These are the ONLY source for the trust and highlights
  // sections — the renderer has no defaults to fall back on, by design.
  trust: z.array(z.object({ title: z.string(), detail: z.string() })).min(3).max(4),
  highlights: z.array(z.object({ title: z.string(), detail: z.string() })).min(3).max(3),
  layout: z.object({
    nav: e(NAV_VARIANTS),
    card: e(CARD_VARIANTS),
    footer: e(FOOTER_VARIANTS),
    imageTreatment: e(IMAGE_TREATMENTS),
    motion: e(MOTION_LEVELS),
    announcement: z.string().max(120), // empty string = no announcement bar
  }),
});

// The authored emotional journey — a SECOND, dedicated call (below) so neither
// strict grammar grows too large. It references products by index.
const NarrativeSchema = z.object({
  narrative: z.array(NarrativeBlockSchema).min(4).max(11),
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
- layout: nav (${NAV_VARIANTS.join(" | ")}), card (${CARD_VARIANTS.join(" | ")}), footer (${FOOTER_VARIANTS.join(" | ")}), imageTreatment (${IMAGE_TREATMENTS.join(" | ")}), motion ("calm" | "lively"), announcement (a short top-bar line, or an empty string for none).
- trust: 3–4 { title, detail } risk-reduction promises in THIS brand's voice. Treat these as BINDING COMMERCIAL TERMS the merchant will publish — so keep them to what any new store can genuinely honour on day one (a returns window, secure checkout, responsive support, how and when things ship). Never state a specific free-shipping threshold, delivery time, warranty length or price guarantee you were not given. Never make an environmental claim ("carbon neutral", "offset", "climate positive") — those are regulated and unprovable here.
- highlights: exactly 3 { title, detail } reasons to want this brand — concrete and specific to this catalogue. Ground them in the product itself (what it is made of, what it does, who it is for, how it was designed). Never claim manufacturing facts you were not given, such as small-batch production, a country of origin, ethical sourcing or certification.

Copy standards:
- HONESTY is absolute. Everything you write will be PUBLISHED BY A REAL MERCHANT and read as their own commitment. This store has no customers and no history, so never invent reviews, ratings, testimonials, customer counts, awards, press mentions, certifications, factories, founding dates or sustainability credentials. Write desire from what is genuinely knowable: the product, the audience and the founder's intent.
- Premium and specific — write as an experienced founder or luxury copywriter. Never generic filler.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "In today's digital world", "Elevate", "Unleash". No exclamation marks, no hype.
- brand.story: 1–2 editorial sentences of honest brand narrative — why this brand exists, what it stands for — customer-facing, no clichés.
- Tagline: editorial, confident, short.
- Product descriptions: concrete and sensory — materials, use, feeling. 1–2 sentences. Never a list of adjectives.
- Prices realistic for the positioning, in EUR. Produce 3–8 products forming one focused, coherent collection.

Brand naming — think like a top branding agency. The name should feel like a company that could realistically become a global brand: memorable, premium, easy to pronounce, easy to spell, emotionally aligned with the brand, and usable internationally. Avoid generic words, awkward combinations, obvious AI-style names, unnecessary punctuation, numbers and random suffixes. If the founder supplied a name, use it as inspiration; if you can create a materially stronger one for this niche and positioning, do so confidently.

FINAL QUALITY GATE — the benchmark is not "a beautiful website". It is DESIRE. Would a customer believe — and want to buy from — this company within five seconds? Would this brand, palette, type and catalogue look at home beside the best DTC brands in the world? If not, raise the quality before returning. Never settle for "good enough".`;

const NARRATIVE_SYSTEM = `You are the Creative Director for Urivo. You are given a finished premium brand — its name, positioning, story and product catalogue — and you now compose the storefront as a controlled EMOTIONAL JOURNEY.

You are NOT choosing sections from a menu. A theme engine asks "which hero layout?". You ask "what story makes someone WANT this product — in what order, at what emotional intensity?". Return \`narrative\`: an ordered list of 5–9 "beats". Every beat exists for a psychological reason (state it in \`intent\`) and carries fully AUTHORED content specific to THIS brand and THESE products. Never boilerplate — nothing here may read like it could belong to another brand.

Each beat is { kind, intent, emphasis ("calm" | "bold"), + the fields that kind uses; leave unused string fields as "" and unused index fields as -1 }. \`emphasis\` is the beat's emotional volume — reserve "bold" for the one or two true peaks; most beats are calm (restraint reads premium).

Beat kinds and the fields each uses:
- hero — THE HOOK. headline = an IDEA, a promise or a benefit, NEVER the brand name (the nav shows the name). Set heroProductIndex (0-based index into the product list) to lead with the hero product itself — the Apple/Seed move — or -1 for an idea-led hero. Uses: eyebrow, headline, subhead, ctaLabel, heroProductIndex.
- spotlight — DESIRE. One product, large, benefit-led. Uses: productIndex, eyebrow, headline, benefits (2–5 concrete sensory outcomes the customer gets), ctaLabel.
- pillars — WHY IT'S WORTH WANTING. Uses: title, items (2–4 of { title, detail }, each a real product-specific reason).
- proof — CREDIBILITY / EDUCATION, the signature beat — ingredients, materials, how it works, provenance. Uses: title, items (3–6 of { label, detail }). Authored specificity here is what separates you from templates.
- story — MEANING. Uses: eyebrow, headline, body (honest, why this brand exists).
- quote — EMOTIONAL PEAK, one line, big type, air. Uses: text, attribution (only if honest — e.g. the founder; else ""). At most once.
- trust — RISK REDUCTION. Uses: items (3–4 of { title, detail }) of HONEST guarantees (returns, secure checkout, shipping, quality) in THIS brand's voice, never generic.
- faq — OBJECTION HANDLING. Uses: items (2–6 of { q, a }) — the real questions THIS product raises.
- collection — THE SHOP (include exactly once). Uses: title (optional).
- cta — THE CLOSE. Uses: headline, subhead, ctaLabel.
- newsletter — RETENTION. Uses: headline, subhead.
- marquee — RHYTHM. Uses: phrases (2–6 short authored proof phrases, not one word repeated).

Composition principles: earn attention and create desire first; introduce the product early and make IT the hero (not the layout); layer meaning and credibility; reduce risk near the decision; close with a clear invitation. Not every brand needs every beat — choose the sequence and intensity that maximise desire and trust for THIS brand. Pace with whitespace and emphasis; premium is calm and deliberate, never a wall of sections.

HONESTY is absolute: this store has no customers yet, so NEVER invent reviews, ratings, testimonials, star counts or "10,000 happy customers". Build desire and trust only from what is real — the product's concrete qualities and materials, honest guarantees, shipping, and the founder's intent.

FINAL GATE: when someone lands here, their first feeling must be "I want this product" — not merely "this looks nice". If a beat doesn't earn that, cut or rewrite it.`;

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
  const { brand, design, products } = result.data;

  // ── Call 2: the Creative Director composes the emotional journey ──────────
  // A dedicated call keeps each strict grammar small, and lets the narrative be
  // authored with full knowledge of the finished brand + real product list.
  const rawNarrative = await composeNarrative(client, brand, design, products);

  // Second gate: clamp/normalise defensively (spec 6.5). The story + narrative
  // ride inside the design system so the renderer needs no extra props.
  const designSystem = parseDesignSystem(
    {
      ...design,
      tagline: brand.tagline,
      story: brand.story,
      narrative: rawNarrative,
    },
    products.length,
  );

  return {
    brand,
    designSystem,
    products,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

type Brand = z.infer<typeof GenerationSchema>["brand"];
type Design = z.infer<typeof GenerationSchema>["design"];
type Products = z.infer<typeof GenerationSchema>["products"];

/** Author the storefront's emotional journey for a finished brand. Best-effort:
 *  on any failure the store still renders (legacy fixed-section fallback). */
async function composeNarrative(
  client: Anthropic,
  brand: Brand,
  design: Design,
  products: Products,
): Promise<unknown> {
  const list = products
    .map((p, i) => `${i}. ${p.title} — €${p.priceEUR} — ${clampText(p.description, 160)}`)
    .join("\n");
  const context = `Brand: ${brand.name} — "${brand.tagline}"
Personality: ${design.personality}
Positioning: ${design.brief.positioning}
Audience: ${design.brief.audience}
Conversion strategy: ${design.brief.conversionStrategy}
Story: ${brand.story}

Products (index. title — price — description):
${clampText(list, AI_INPUT_BUDGET.editorHistoryChars)}

Compose the emotional journey (narrative) that makes this specific customer want these products.`;

  try {
    const res = await client.messages.parse({
      model: STORE_GENERATOR_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(NarrativeSchema) },
      system: [{ type: "text", text: NARRATIVE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: context }],
    });
    if (res.stop_reason === "refusal") return null;
    const p = NarrativeSchema.safeParse(res.parsed_output);
    return p.success ? p.data.narrative : null;
  } catch {
    return null; // the store renders via the legacy path
  }
}
