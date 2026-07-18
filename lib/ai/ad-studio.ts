import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/*
 * Ad Studio — channel strategy + platform-ready ad creative for a store.
 *
 * Honest scope: this generates strategy and copy. Live ad *performance*
 * analytics needs a Google/Meta Ads connection (or manual data) — surfaced in
 * the UI, not faked here. Only place the ads conversation touches the AI SDK
 * (spec 6.9).
 */

export const AD_MODEL = "claude-opus-4-8";

const PLATFORMS = ["Meta", "Google", "TikTok", "Pinterest"] as const;
const FIT = ["high", "medium", "low"] as const;

const AdSchema = z.object({
  strategy: z.object({
    primaryAngle: z.string().min(15).max(300),
    channels: z
      .array(
        z.object({
          platform: z.enum(PLATFORMS),
          fit: z.enum(FIT),
          why: z.string().min(15).max(300),
          budgetHint: z.string().min(4).max(120),
        }),
      )
      .min(2)
      .max(4),
    targeting: z.array(z.string().min(4).max(160)).min(2).max(5),
  }),
  creatives: z
    .array(
      z.object({
        platform: z.enum(PLATFORMS),
        format: z.string().min(2).max(40),
        angle: z.string().min(3).max(80),
        headline: z.string().min(3).max(120),
        primaryText: z.string().min(10).max(600),
        cta: z.string().min(2).max(30),
      }),
    )
    .min(5)
    .max(8),
});

export type AdPlan = z.infer<typeof AdSchema>;

export interface AdStore {
  name: string;
  tagline: string;
  personality: string;
  products: { title: string; description: string; priceEUR: number }[];
}

const SYSTEM_PROMPT = `You are Urivo's performance marketer — a direct-response strategist who has scaled DTC brands. Given a store, you produce a channel strategy and platform-ready ad creative that could ship today.

Standards:
- Grounded in THIS brand — its name, voice, products, price points. Never generic.
- Match each platform's reality:
  · Google (Search RSA): headlines punchy and ≤30 characters; intent-led.
  · Meta (Feed/Story): conversational primary text, a scroll-stopping first line, a clear hook.
  · TikTok: native, casual, creator-voice; hook in the first sentence.
  · Pinterest: aspirational, keyword-aware, calm.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world". No fake urgency, no ALL CAPS shouting.
- Honest: propose budget as sensible starting ranges (e.g. "€20–40/day to test"), not guarantees.

Produce:
- strategy.primaryAngle: the single sharpest message this brand should lead with.
- strategy.channels: 2–4 platforms with a fit (high/medium/low), why, and a budget hint.
- strategy.targeting: 2–5 concrete audience/targeting angles.
- creatives: 5–8 ready-to-run ads across the recommended platforms — each with platform, format, the angle, a headline, primary text, and a CTA. Respect each platform's format and length.`;

export async function generateAdPlan(apiKey: string, store: AdStore): Promise<AdPlan> {
  const client = new Anthropic({ apiKey });
  const products = store.products.length
    ? store.products.map((p) => `  - ${p.title} (€${p.priceEUR.toFixed(2)}): ${p.description}`).join("\n")
    : "  (no products yet)";
  const context = `Store: ${store.name}${store.tagline ? ` — "${store.tagline}"` : ""}
Personality: ${store.personality}
Products:
${products}`;

  const response = await client.messages.parse({
    model: AD_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(AdSchema) },
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: context },
    ],
    messages: [{ role: "user", content: "Build the channel strategy and the ad creative for this store." }],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = AdSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");
  return result.data;
}
