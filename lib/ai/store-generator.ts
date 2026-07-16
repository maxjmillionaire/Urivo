import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/*
 * Store generation orchestrator (specs 1, 6.3, 6.5).
 *
 * This module is the ONLY place business logic touches the AI provider SDK
 * (spec 6.9: providers isolated behind clean services). Swapping providers or
 * models happens here, never in routes or components.
 *
 * Prompt is versioned inline for byte-stable prompt caching and guaranteed
 * availability in the serverless bundle. The version is persisted with each
 * generation for reproducibility (spec 6.3 §22).
 */

export const STORE_GENERATOR_MODEL = "claude-opus-4-8";
export const STORE_GENERATOR_PROMPT_VERSION = "v1";

const ALLOWED_HEADING_FONTS = ["Playfair Display", "Didot", "Georgia"] as const;
const ALLOWED_BODY_FONTS = ["Inter", "SF Pro Display", "Helvetica"] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Schema the model must satisfy. Business bounds (lengths, price, hex) are
 *  validated client-side by the SDK and re-checked below. */
const GenerationSchema = z.object({
  brand: z.object({
    name: z.string().min(2).max(60),
    tagline: z.string().min(4).max(120),
    headingFont: z.enum(ALLOWED_HEADING_FONTS),
    bodyFont: z.enum(ALLOWED_BODY_FONTS),
    background: z.string().regex(HEX),
    structure: z.string().regex(HEX),
    accent: z.string().regex(HEX),
  }),
  products: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().min(10).max(400),
        priceEUR: z.number().positive().max(100000),
      }),
    )
    .min(3)
    .max(6),
});

export type GenerationResult = z.infer<typeof GenerationSchema>;

const SYSTEM_PROMPT = `You are the lead brand designer and copywriter for Urivo, a premium AI commerce platform. Given a founder's business idea, you design a complete, cohesive storefront: a brand identity and a small curated product catalog.

Standards you must meet:
- Premium and specific. Write as an experienced founder or luxury copywriter would, never as generic marketing filler.
- Banned words and phrases: "Revolutionary", "Unlock", "Dive into", "Game-changing", "In today's digital world", "Elevate", "Unleash". Never use them.
- The brand name must be inventable and ownable — not a generic dictionary word, not the founder's literal prompt echoed back.
- The tagline is editorial and confident: short, no exclamation marks, no hype.
- Product descriptions are concrete and sensory. Name materials, use, feeling. 1–2 sentences. Never list adjectives.
- Prices are realistic for the positioning, in EUR.

Design system:
- Choose a palette of three hex colors that feel expensive together: a light background, a deep structural color, and one accent. High contrast between background and structure (text must be readable). Avoid pure black and pure white.
- headingFont is a serif from the allowed set; bodyFont is a sans from the allowed set.

Produce 4–6 products that form a coherent, focused collection — not a random assortment.`;

export interface StoreGenerationInput {
  prompt: string;
}

/**
 * Generate a validated brand + catalog from a founder prompt.
 * Throws on missing configuration, provider failure, or invalid AI output.
 */
export async function generateStore(
  input: StoreGenerationInput,
): Promise<GenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: STORE_GENERATOR_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(GenerationSchema),
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Design a storefront for this business:\n\n${input.prompt.trim()}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("AI_REFUSED");
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("AI_INVALID_OUTPUT");
  }

  // Re-validate business rules — never trust AI output (spec 6.3 §23).
  const result = GenerationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("AI_INVALID_OUTPUT");
  }
  return result.data;
}
