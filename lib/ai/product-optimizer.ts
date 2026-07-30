import "server-only";
import { modelFor } from "./models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { AI_INPUT_BUDGET, clampText } from "./limits";
import type { TokenUsage } from "@/lib/finance/cost-model";

/*
 * Product copy optimizer — turns a raw supplier listing (keyword-stuffed title,
 * generic description) into on-brand copy that matches the store's voice. Used
 * by the auto-source pipeline so imported products never look like AliExpress.
 *
 * One batched call rewrites the whole catalogue at once (cost- and latency-
 * efficient). The ONLY place this touches the AI SDK (spec 6.9). Output is
 * re-validated and clamped; on any failure the caller keeps the raw copy.
 */

export const OPTIMIZER_MODEL = modelFor("productOptimizer");

const OptimizedSchema = z.object({
  products: z
    .array(
      z.object({
        title: z.string().min(2).max(120),
        description: z.string().min(10).max(400),
      }),
    )
    .min(1)
    .max(24),
});

export type OptimizedCopy = z.infer<typeof OptimizedSchema>["products"];

export interface OptimizerBrand {
  name: string;
  tagline: string;
  personality: string;
}
export interface RawListing {
  title: string;
  description: string | null;
}

export type CopyStyle = "editorial" | "benefit" | "sensory";

const STYLE_DIRECTION: Record<CopyStyle, string> = {
  editorial: "Voice: minimal and editorial — understated, confident, magazine-like. Short, precise lines.",
  benefit: "Voice: benefit-led — lead with what the product does for the customer, concrete and persuasive without hype.",
  sensory: "Voice: warm and sensory — evoke material, texture and feeling; tactile and inviting.",
};

const SYSTEM_PROMPT = `You are Urivo's merchandiser. You rewrite raw supplier product listings into premium, on-brand copy for a specific store. You receive the brand and a numbered list of products; return the SAME number of products, in the SAME order.

For each product:
- title: a clean, benefit-led product name in the brand's voice — not the supplier's keyword-stuffed title. No ALL CAPS, no "2024", no shipping/brand-noise, no specs dump.
- description: 1–2 sensory, concrete sentences that fit the brand — materials, use, feeling. Never a list of adjectives, never generic filler.
- Match the brand personality exactly. Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world". No exclamation marks, no hype.
Keep it truthful to what the product actually is — improve the writing, don't invent features.`;

/**
 * Rewrite raw listings into on-brand copy. Returns copy aligned to the input
 * order, plus token usage for the ledger. Throws on provider/validation failure
 * (caller falls back to raw copy).
 */
export async function optimizeProductCopy(
  apiKey: string,
  brand: OptimizerBrand,
  listings: RawListing[],
  style?: CopyStyle,
): Promise<{ products: OptimizedCopy; usage: TokenUsage }> {
  const client = new Anthropic({ apiKey });
  const styleLine = style ? `\n${STYLE_DIRECTION[style]}` : "";

  const list = listings
    .slice(0, 24)
    .map(
      (l, i) =>
        `${i + 1}. ${clampText(l.title, 160)}${l.description ? ` — ${clampText(l.description, 300)}` : ""}`,
    )
    .join("\n");

  const context = `Brand: ${brand.name}${brand.tagline ? ` — "${brand.tagline}"` : ""}
Personality: ${clampText(brand.personality, 120)}

Rewrite these ${Math.min(listings.length, 24)} products (keep order):
${clampText(list, AI_INPUT_BUDGET.editorHistoryChars)}`;

  const response = await client.messages.parse({
    model: OPTIMIZER_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(OptimizedSchema) },
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ...(styleLine ? [{ type: "text" as const, text: styleLine }] : []),
    ],
    messages: [{ role: "user", content: context }],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = OptimizedSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");

  return {
    products: result.data.products,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
