import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/*
 * "Ask Urivo" — the in-product assistant behind the companion rail.
 *
 * Like the store generator (spec 6.9), this is the ONLY place the assistant
 * conversation touches the AI provider SDK. It is grounded in the merchant's
 * own store so answers are specific, and it is deliberately honest about its
 * current reach: it can advise, plan and draft, and it says so plainly rather
 * than claiming to have mutated a store it cannot yet write to.
 */

export const ASSISTANT_MODEL = "claude-opus-4-8";
export const ASSISTANT_PROMPT_VERSION = "v1";

const MAX_TURNS = 20; // bound history sent upstream
const MAX_TOKENS = 700;

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StoreContext {
  name: string;
  subdomain: string;
  tagline?: string | null;
  isLive: boolean;
  palette: { background: string; structure: string; accent: string };
  products: { title: string; description?: string | null; priceEUR: number }[];
}

const SYSTEM_PROMPT = `You are Urivo — the assistant inside a founder's commerce operating system. You speak with the calm authority of a senior brand strategist and merchandiser who knows this founder's store intimately.

How you work:
- Be specific to THIS store. Reference the real brand name, tagline, palette and products you are given. Never answer generically.
- Be concise and premium. Two to five sentences, or a short tight list. No filler, no hype, no exclamation marks.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world".
- When the founder asks for an edit (rewrite copy, add a product, change a colour), do the creative work in your reply — draft the actual headline, write the actual product, name the actual hex — as a concrete proposal they can accept.
- Be honest about reach: you draft and plan here in the rail; applying changes to the live store is done from the store editor. Offer the finished draft, don't pretend it is already published.
- Never invent metrics, orders or traffic you were not given.`;

function contextBlock(store: StoreContext | null): string {
  if (!store) {
    return `The founder has not generated a store yet. Encourage them toward their first store and help them shape the idea — positioning, name direction, first products — without pretending a store exists.`;
  }
  const products = store.products.length
    ? store.products
        .map(
          (p) =>
            `  - ${p.title} — €${p.priceEUR.toFixed(2)}${p.description ? `: ${p.description}` : ""}`,
        )
        .join("\n")
    : "  (no products yet)";
  return `Current store:
- Brand: ${store.name}${store.tagline ? ` — "${store.tagline}"` : ""}
- Address: ${store.subdomain}.urivo.ai${store.isLive ? " (live)" : " (draft)"}
- Palette: background ${store.palette.background}, structure ${store.palette.structure}, accent ${store.palette.accent}
- Products:
${products}`;
}

/**
 * Stream a grounded assistant reply as plain-text chunks. Yields text deltas as
 * they arrive so the rail can render token-by-token.
 */
export async function* streamAssistantReply(
  apiKey: string,
  history: AssistantMessage[],
  store: StoreContext | null,
): AsyncGenerator<string, void, unknown> {
  const client = new Anthropic({ apiKey });
  const turns = history.slice(-MAX_TURNS);

  const stream = client.messages.stream({
    model: ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: contextBlock(store) },
    ],
    messages: turns.map((m) => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
