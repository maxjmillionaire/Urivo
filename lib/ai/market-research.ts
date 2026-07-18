import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/*
 * Market Research / Product Discovery (front of the funnel).
 *
 * Given a niche or idea, Urivo produces a structured market read, audience,
 * positioning, competitor gaps and candidate winning products — each of which
 * can seed a store generation. This is the ONLY place the research conversation
 * touches the AI SDK (spec 6.9).
 *
 * Honesty: this is a strategist's *assessment* from the model's training, not
 * live market data — the UI labels it as such. It is opinionated and specific,
 * never generic filler.
 */

export const RESEARCH_MODEL = "claude-opus-4-8";
export const RESEARCH_PROMPT_VERSION = "v1";

const DEMAND_LEVELS = ["emerging", "growing", "established", "saturated"] as const;

const ResearchSchema = z.object({
  niche: z.string().min(2).max(80),
  summary: z.string().min(20).max(400),
  demand: z.object({
    level: z.enum(DEMAND_LEVELS),
    rationale: z.string().min(20).max(400),
    seasonality: z.string().max(200).nullable(),
  }),
  audience: z
    .array(
      z.object({
        segment: z.string().min(2).max(60),
        who: z.string().min(10).max(240),
        pains: z.array(z.string().min(3).max(120)).min(1).max(4),
        trigger: z.string().min(10).max(240),
      }),
    )
    .min(2)
    .max(3),
  positioning: z
    .array(z.object({ angle: z.string().min(3).max(80), why: z.string().min(15).max(300) }))
    .min(2)
    .max(4),
  competitors: z.object({
    landscape: z.string().min(20).max(500),
    gaps: z.array(z.string().min(8).max(200)).min(2).max(4),
  }),
  products: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        description: z.string().min(20).max(300),
        priceRange: z.string().min(2).max(40),
        whyItWins: z.string().min(15).max(300),
      }),
    )
    .min(3)
    .max(5),
  brand: z.object({
    name: z.string().min(2).max(60),
    tagline: z.string().min(4).max(120),
    vibe: z.string().min(4).max(120),
  }),
});

export type ResearchResult = z.infer<typeof ResearchSchema>;

const SYSTEM_PROMPT = `You are Urivo's market strategist — the analyst a sharp founder wishes they had. Given a niche or product idea, you produce a focused, opinionated market read that leads to a launchable store.

Standards:
- Specific and grounded. Reference real buyer behaviour, real category dynamics, real positioning wedges — never generic "the market is growing" filler.
- Honest. This is your assessment from what you know, not live data. Don't invent precise statistics (no fake "$4.2B TAM, 12% CAGR"). Speak qualitatively and credibly.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world".

Produce:
- niche: a crisp label for the space.
- summary: 1–2 sentences on the opportunity and the wedge.
- demand: a level (emerging | growing | established | saturated) with a concrete rationale, and seasonality if it matters (else null).
- audience: 2–3 real segments — who they are, their pains, and what actually triggers a purchase.
- positioning: 2–4 distinct angles to win, each with why it works here.
- competitors: an honest read of the landscape and 2–4 specific gaps a new brand can own.
- products: 3–5 candidate "winning products" — concrete, sensory descriptions, a realistic EUR price range, and why each wins in this market.
- brand: one ownable brand direction (inventable name, editorial tagline, a short vibe) to seed the store.`;

export interface ResearchInput {
  prompt: string;
}

/** Produce a validated market-research report from a niche/idea prompt. */
export async function runMarketResearch(input: ResearchInput): Promise<ResearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: RESEARCH_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ResearchSchema) },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Research this market and find the wedge and the winning products:\n\n${input.prompt.trim()}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = ResearchSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");
  return result.data;
}
