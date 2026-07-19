import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/*
 * Name Studio — brandable store-name ideas for a founder's idea.
 *
 * Produces a shortlist of ownable, memorable brand names. The route pairs each
 * with a REAL availability check (lib/naming) before showing it, so a founder
 * only ever sees names they can actually take — the "we've got you" feeling.
 * This is the only place name-ideation touches the AI SDK (spec 6.9).
 */

export const NAME_MODEL = "claude-opus-4-8";
export const NAME_PROMPT_VERSION = "v1";

const NamesSchema = z.object({
  names: z
    .array(
      z.object({
        name: z.string().min(2).max(32),
        rationale: z.string().min(8).max(120),
      }),
    )
    .min(6)
    .max(12),
});

export type NameIdeas = z.infer<typeof NamesSchema>;

const SYSTEM_PROMPT = `You are Urivo's brand-naming director. Given a founder's product idea, you invent a shortlist of premium, ownable store names.

Standards:
- Brandable and short (1–2 words, ideally one). Easy to say, spell and remember.
- Ownable and distinctive — coined words, evocative roots, clean compounds. Never generic ("BestSkincareShop") and never a literal category label.
- Premium and timeless, matched to the idea's world. Avoid trendy filler and avoid anything that dates quickly.
- No trademarks of real, known companies. No numbers-for-letters gimmicks. No hyphens.
- Banned words in names: "Hub", "Zone", "World", "Central", "Pro", "Store", "Shop" (as a suffix).

For each name give a 6–14 word rationale — the feeling or idea it carries. Return 8–12 candidates, varied in style (some coined, some evocative real words, some compounds) so the founder has a genuine choice.`;

export interface NameInput {
  prompt: string;
}

/** Produce a validated shortlist of brandable store-name ideas. */
export async function suggestStoreNames(input: NameInput): Promise<NameIdeas> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: NAME_MODEL,
    max_tokens: 1500,
    output_config: { effort: "medium", format: zodOutputFormat(NamesSchema) },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Invent brandable store names for this idea:\n\n${input.prompt.trim()}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = NamesSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");
  return result.data;
}
