import "server-only";
import { modelFor } from "./models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { buildUserContent, type Attachment } from "./attachments";
import { AD_PLATFORMS, enforceLimits, findViolations, renderPlatformLimits, PLATFORM_LIMITS, type AdPlatform } from "./ad-platforms";
import { renderAdPerformance, type AdPerformance } from "./ad-context";
import { renderAdHistory, type CreativePerformance } from "./ad-performance";
import type { TokenUsage } from "@/lib/finance/cost-model";

/*
 * Ad Studio — channel strategy + platform-ready ad creative for a store.
 *
 * Honest scope: this generates strategy and copy. Live ad *performance*
 * analytics needs a Google/Meta Ads connection (or manual data) — surfaced in
 * the UI, not faked here. Only place the ads conversation touches the AI SDK
 * (spec 6.9).
 */

export const AD_MODEL = modelFor("adStudio");

// One list, shared with the limits table — a platform the schema allows but
// the table does not know would ship unchecked.
const PLATFORMS = AD_PLATFORMS;
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
- If PAST ADS are listed below, they are measured results from this store. Beat them: repeat what the winners had in common, and never re-propose an angle that has already been tested and failed.
- USE THE PERFORMANCE NUMBERS BELOW. They are this store's real traffic and sales, not an example. A store with no visitors needs reach, not conversion tweaks; a store with visitors and no sales does not need more spend. Say which situation this is, and let the plan follow from it. Never invent a figure that is not given.

Produce:
- strategy.primaryAngle: the single sharpest message this brand should lead with.
- strategy.channels: 2–4 platforms with a fit (high/medium/low), why, and a budget hint.
- strategy.targeting: 2–5 concrete audience/targeting angles.
- creatives: 5–8 ready-to-run ads across the recommended platforms — each with platform, format, the angle, a headline, primary text, and a CTA. Respect each platform's format and length.`;

export interface AdOutcome {
  plan: AdPlan;
  usage: TokenUsage;
  /** Copy that had to be cut to fit a platform — surfaced, never silent. */
  adjusted: string[];
}

/*
 * Existing creatives, UGC videos, product photos, competitor ads.
 *
 * This is the surface where uploads change the work most. Without one, Ad
 * Studio writes ads from a product list — competent, but blind to what the
 * merchant has already tried. With one it can say why a specific creative is
 * failing: the hook lands three seconds too late, the product is off-frame
 * until the end, the on-screen text competes with the logo. That critique is
 * not available from a text description of an ad.
 *
 * Video arrives here as ordered frames (extracted in the browser — the API has
 * no video block), which is enough for hook, pacing and framing, and not
 * enough for audio. The prompt says so, so the model does not invent a read of
 * a voiceover it never heard.
 */
export async function generateAdPlan(
  apiKey: string,
  store: AdStore,
  attachments?: Attachment[],
  /** This store's real traffic and sales. Omitted only when unreadable. */
  performance?: AdPerformance,
  /**
   * How previously generated ads actually did — measured, not modelled.
   *
   * This is what makes the second run better than the first instead of
   * another fresh guess. An angle that sold is a pattern to repeat; one that
   * took 400 clicks and produced nothing is a question already answered.
   */
  history?: CreativePerformance[],
): Promise<AdOutcome> {
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
      // Stable across every store, so worth caching. The store context and its
      // numbers change per request and sit after the breakpoint.
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: renderPlatformLimits() },
      { type: "text", text: context },
      ...(performance ? [{ type: "text" as const, text: renderAdPerformance(performance) }] : []),
      ...(() => {
        const past = history ? renderAdHistory(history) : null;
        return past ? [{ type: "text" as const, text: past }] : [];
      })(),
    ],
    messages: [
      {
        role: "user",
        content: buildUserContent(
          attachments?.length
            ? "Build the channel strategy and the ad creative for this store. The attached material is existing or reference creative — read it first and say specifically what works and what does not (hook timing, framing, on-screen text, the offer), then write ads that beat it. Judge only what you can see; do not comment on audio."
            : "Build the channel strategy and the ad creative for this store.",
          attachments,
        ) as Anthropic.MessageParam["content"],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = AdSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");

  let plan = result.data;
  let inputTokens = response.usage?.input_tokens ?? 0;
  let outputTokens = response.usage?.output_tokens ?? 0;

  /*
   * Enforce the platform limits the schema cannot express.
   *
   * Ask the model to rewrite anything over the line before cutting it —
   * a rewritten headline is still an ad, a truncated one is damage. The
   * repair is a second call, so it only runs when something actually
   * overflowed; in practice the first pass usually complies.
   */
  const violations = findViolations(plan.creatives);
  if (violations.length > 0) {
    const repair = await repairOverlong(client, plan, violations).catch(() => null);
    if (repair) {
      plan = { ...plan, creatives: repair.creatives };
      inputTokens += repair.usage.inputTokens;
      outputTokens += repair.usage.outputTokens;
    }
  }

  // Whatever survives the repair is cut to fit. An ad the merchant cannot
  // upload is worse than one that lost its last three words.
  const { creatives, adjusted } = enforceLimits(plan.creatives);

  return {
    plan: { ...plan, creatives } as AdPlan,
    usage: { inputTokens, outputTokens },
    adjusted,
  };
}

const RepairSchema = z.object({
  creatives: z
    .array(z.object({ index: z.number().int(), headline: z.string(), primaryText: z.string() }))
    .min(1)
    .max(8),
});

/**
 * Rewrite only the fields that overflowed, keeping the angle intact.
 *
 * Deliberately narrow: it is handed the offending copy and the exact budget it
 * has to hit, not the whole brief. Regenerating the full plan would risk
 * losing creatives that were already good in order to fix one that was long.
 */
async function repairOverlong(
  client: Anthropic,
  plan: AdPlan,
  violations: ReturnType<typeof findViolations>,
): Promise<{ creatives: AdPlan["creatives"]; usage: TokenUsage } | null> {
  const indices = [...new Set(violations.map((v) => v.index))];
  const brief = indices
    .map((i) => {
      const c = plan.creatives[i];
      const limits = PLATFORM_LIMITS[c.platform as AdPlatform];
      return `[${i}] ${c.platform} — angle: ${c.angle}
  headline (${c.headline.length}/${limits.headline}): ${c.headline}
  body (${c.primaryText.length}/${limits.primaryText}): ${c.primaryText}`;
    })
    .join("\n\n");

  const res = await client.messages.parse({
    model: AD_MODEL,
    max_tokens: 1500,
    output_config: { effort: "low", format: zodOutputFormat(RepairSchema) },
    system: [
      {
        type: "text",
        text: "Rewrite ad copy that is over its platform's character limit. Keep the angle, the offer and the voice exactly — only make it fit. Shorter is not weaker: cut qualifiers and connectives before you cut the concrete detail that makes the ad work. Return every listed index with a headline and body inside the stated limits.",
      },
    ],
    messages: [{ role: "user", content: `These are over the limit. Rewrite each to fit:\n\n${brief}` }],
  });

  const parsed = RepairSchema.safeParse(res.parsed_output);
  if (!parsed.success) return null;

  const next = [...plan.creatives];
  for (const fix of parsed.data.creatives) {
    const target = next[fix.index];
    if (!target) continue;
    next[fix.index] = { ...target, headline: fix.headline, primaryText: fix.primaryText };
  }
  return {
    creatives: next,
    usage: {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    },
  };
}
