import "server-only";
import { modelFor } from "./models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
  type StoreDesignSystem,
} from "@/lib/storefront/design-system";
import { AIEditPlanSchema } from "./edit-plan";
import { AI_INPUT_BUDGET, boundHistory, clampText } from "./limits";
import type { TokenUsage } from "@/lib/finance/cost-model";

/*
 * "Ask Urivo" store editor. Given the merchant's live store and an instruction,
 * the model either answers conversationally OR proposes a structured, minimal
 * edit — never both silently applied. The plan is re-validated and clamped
 * before anything touches the store (spec 6.5). This is the only place the
 * editing conversation touches the AI SDK (spec 6.9).
 */

export const EDITOR_MODEL = modelFor("storeEdit");

const AIEditSchema = z.object({
  reply: z.string().min(1).max(1200),
  edit: AIEditPlanSchema.nullable(),
});

export type AIEdit = z.infer<typeof AIEditSchema>;

export interface EditorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EditorStore {
  name: string;
  tagline: string;
  ds: StoreDesignSystem;
  products: { title: string; description: string; priceEUR: number }[];
}

const SYSTEM_PROMPT = `You are Urivo — the assistant that edits a founder's live storefront by conversation. You know this store intimately and you speak like a senior brand designer: calm, specific, confident. No hype, no exclamation marks.

For each message you either:
1) ANSWER conversationally (edit = null) — when the founder asks a question, is unclear, or wants advice; or
2) PROPOSE AN EDIT (edit = { summary, ... }) — when they ask to change something.

Rules for edits:
- Change only what was asked. Include ONLY the fields that should change; omit everything else. Never restyle the whole store for a small request.
- Keep it coherent and premium — the store must still look like the work of a great agency after your change.
- "summary" is one plain sentence describing exactly what will change, e.g. "Rewrites the tagline and warms the accent to a soft terracotta."
- Your "reply" is what you say to the founder — a short, human confirmation of what you're proposing (the UI shows an Apply button separately). Don't dump the raw values.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash".
- Language: write your "reply" in the SAME language the founder writes to you in (German, French, Spanish, Arabic, Japanese — anything), fluently and in this same calm voice. But the STORE content you set (name, tagline, personality, product copy, announcement) stays in the store's current language — only translate or switch that language when the founder explicitly asks you to.

Design fields you may set (all optional):
- Copy: name, tagline, personality (short art-direction phrase).
- Palette (hex): background, ink (text), accent. Keep strong background/text contrast.
- Fonts: headingKey, bodyKey from: ${FONT_KEYS.join(", ")}.
- Shape: radius (0 sharp–32 round), buttonShape (${BUTTON_SHAPES.join("|")}), shadow (${SHADOW_LEVELS.join("|")}).
- Feel: density (${DENSITIES.join("|")}), motion (${MOTION_LEVELS.join("|")}).
- Layout archetypes: nav (${NAV_VARIANTS.join("|")}), hero (${HERO_VARIANTS.join("|")}), card (${CARD_VARIANTS.join("|")}), footer (${FOOTER_VARIANTS.join("|")}), imageTreatment (${IMAGE_TREATMENTS.join("|")}).
- announcement (short top-bar line, or null to remove), sectionOrder (ordered subset of: ${SECTION_KEYS.join(", ")}; always include hero and collection).

Products (optional array; reference existing ones by their 0-based index shown below):
- { action: "add", title, description, priceEUR }
- { action: "update", index, and any of title/description/priceEUR }
- { action: "remove", index }

Write product copy concrete and sensory (materials, use, feeling), 1–2 sentences.`;

function contextBlock(store: EditorStore): string {
  const d = store.ds;
  const products = store.products.length
    ? store.products.map((p, i) => `  [${i}] ${p.title} — €${p.priceEUR.toFixed(2)}: ${p.description}`).join("\n")
    : "  (no products yet)";
  return `Current store:
- Name: ${store.name}
- Tagline: ${store.tagline || "(none)"}
- Personality: ${d.personality}
- Palette: background ${d.palette.background}, ink ${d.palette.ink}, accent ${d.palette.accent}
- Fonts: heading ${d.fonts.headingKey}, body ${d.fonts.bodyKey}
- Shape: radius ${d.shape.radius}, button ${d.shape.buttonShape}, shadow ${d.shape.shadow}
- Feel: density ${d.space.density}, motion ${d.layout.motion}
- Layout: nav ${d.layout.nav}, hero ${d.layout.hero}, card ${d.layout.card}, footer ${d.layout.footer}, image ${d.layout.imageTreatment}
- Sections: ${d.layout.sectionOrder.join(" → ")}
- Announcement: ${d.layout.announcement ?? "(none)"}
- Products:
${products}`;
}

export interface EditOutcome {
  result: AIEdit;
  usage: TokenUsage;
}

export async function proposeStoreEdit(
  apiKey: string,
  store: EditorStore,
  history: EditorMessage[],
): Promise<EditOutcome> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: EDITOR_MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(AIEditSchema) },
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: contextBlock(store) },
    ],
    // Hard-bound the conversation input (turns + total chars) so a long history
    // can't inflate cost past the credit it charges (spec 6.2). Output is capped
    // by max_tokens above; this caps the other end.
    messages: boundHistory(
      history,
      AI_INPUT_BUDGET.editorMaxTurns,
      AI_INPUT_BUDGET.editorHistoryChars,
    ).map((m) => ({
      role: m.role,
      content: clampText(m.content, AI_INPUT_BUDGET.askPerMessageChars),
    })),
  });

  if (response.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI_INVALID_OUTPUT");
  const result = AIEditSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI_INVALID_OUTPUT");
  return {
    result: result.data,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
