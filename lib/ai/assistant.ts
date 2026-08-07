import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "./models";
import { AI_INPUT_BUDGET, boundHistory, clampText } from "./limits";
import { buildUserContent, type Attachment } from "./attachments";
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
} from "@/lib/storefront/design-system";
import { AIEditPlanSchema, type AIEditPlan } from "./edit-plan";
import { renderContext, type AssistantContext } from "./context";
import type { TokenUsage } from "@/lib/finance/cost-model";

/*
 * "Ask Urivo" — the assistant behind the companion rail.
 *
 * ONE conversation, always streaming, that can both think and act.
 *
 * It used to be two disconnected engines chosen by whether a store existed. The
 * storeless half streamed short advice; the moment a founder had a store, every
 * message — including "why is nobody buying?" — was routed through a
 * structured, NON-streaming edit proposer, so the rail showed bouncing dots for
 * the whole call and then dumped a block of text. That is the opposite of what
 * makes an assistant feel capable.
 *
 * Now there is a single streaming call. Urivo answers in prose as it thinks, and
 * when a change is genuinely wanted it calls `propose_store_edit` — so one turn
 * can diagnose a problem AND propose the fix. The plan is still never applied
 * without the founder pressing Apply.
 */

export const ASSISTANT_MODEL = modelFor("assistant");
export const ASSISTANT_PROMPT_VERSION = "v2";

/*
 * Output ceiling. Raised from 700 — five sentences could not answer "give me a
 * 30-day launch plan" — but bounded, because `max_tokens` covers thinking AND
 * text, and the worst-case cost of a 1-credit turn must stay under budget. See
 * the cost table in ./limits.ts, which this number is part of.
 */
const MAX_TOKENS = 2400;

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the caller receives while the answer is produced. */
export type AssistantEvent =
  | { type: "phase"; phase: "thinking" | "writing" }
  | { type: "text"; text: string }
  | { type: "edit"; edit: AIEditPlan }
  | { type: "usage"; usage: TokenUsage };

const list = (v: readonly string[]) => v.join(" | ");

/*
 * The action Urivo can take. Declared as a tool rather than as a forced
 * structured output, so proposing a change is a CHOICE the model makes when a
 * change was actually asked for — not a shape every message must be squeezed
 * into. Its input is re-validated against AIEditPlanSchema before it is shown,
 * and again server-side before anything is written.
 */
const PROPOSE_EDIT_TOOL: Anthropic.Tool = {
  name: "propose_store_edit",
  description:
    "Propose a concrete change to the founder's storefront. Call this ONLY when they asked for something to change. The change is shown to them with an Apply button and is never applied on your behalf — so propose the real, finished thing, not a placeholder. Include only the fields that should change.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One plain sentence naming exactly what will change, e.g. \"Rewrites the tagline and warms the accent to a soft terracotta.\"",
      },
      design: {
        type: "object",
        description: "Design-system fields to change. Omit any field that should stay as it is.",
        properties: {
          name: { type: "string", description: "Brand name." },
          tagline: { type: "string" },
          personality: { type: "string", description: "Short art-direction phrase." },
          background: { type: "string", description: "#RRGGBB page background." },
          ink: { type: "string", description: "#RRGGBB text colour. Must stay readable on the background." },
          accent: { type: "string", description: "#RRGGBB single brand accent." },
          headingKey: { type: "string", enum: [...FONT_KEYS] },
          bodyKey: { type: "string", enum: [...FONT_KEYS] },
          radius: { type: "number", description: "Corner radius, 0 sharp to 32 round." },
          buttonShape: { type: "string", enum: [...BUTTON_SHAPES] },
          shadow: { type: "string", enum: [...SHADOW_LEVELS] },
          density: { type: "string", enum: [...DENSITIES] },
          nav: { type: "string", enum: [...NAV_VARIANTS] },
          hero: { type: "string", enum: [...HERO_VARIANTS] },
          card: { type: "string", enum: [...CARD_VARIANTS] },
          footer: { type: "string", enum: [...FOOTER_VARIANTS] },
          imageTreatment: { type: "string", enum: [...IMAGE_TREATMENTS] },
          motion: { type: "string", enum: [...MOTION_LEVELS] },
          announcement: { type: ["string", "null"], description: "Top-bar line, or null to remove it." },
          sectionOrder: {
            type: "array",
            items: { type: "string", enum: [...SECTION_KEYS] },
            description: "Ordered page sections. Always include hero and collection.",
          },
        },
        additionalProperties: false,
      },
      products: {
        type: "array",
        description: "Catalogue changes. Reference existing products by the 0-based index shown in context.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "update", "remove"] },
            index: { type: "number", description: "Required for update and remove." },
            title: { type: "string" },
            description: { type: "string", description: "Concrete and sensory — materials, use, feeling. 1–2 sentences." },
            priceEUR: { type: "number" },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
      setLive: { type: "boolean", description: "Publish the store. Only when explicitly asked." },
    },
    required: ["summary"],
  },
};

const SYSTEM_PROMPT = `You are Urivo — the operator inside a founder's commerce operating system. You are not a general chatbot bolted onto a dashboard: you can see this founder's real store, their real traffic and their real revenue, and you are expected to use them.

Think like a senior operator who has launched brands before: a merchandiser, brand strategist and growth lead in one. Calm, specific, direct. You are willing to tell a founder the uncomfortable thing.

HOW TO ANSWER
- Match the answer to the question. A one-line question gets a one-line answer. "Why is nobody buying?" or "Give me a 30-day launch plan" deserves real structure and real length — work the problem, don't summarise it.
- Lead with the answer, then the reasoning. Never open with a restatement of the question or a preamble about what you're about to do.
- Use the numbers you were given, by name. "You've had 214 visitors and no orders" beats "your conversion could be better". If a number is zero, say so — a zero is the most useful fact on the page.
- Diagnose before you prescribe. No traffic is not a conversion problem. An unpublished store is not a copy problem. An unconnected Stripe account is not a pricing problem. Name the real constraint first, even when the founder asked about something else — then answer what they asked.
- Rank your advice. If you give several actions, say which one to do first and why. Never hand over an undifferentiated list.
- Formatting: markdown. Short paragraphs, **bold** for the thing that matters, \`-\` bullets and numbered lists for sequences, ### headings only when the answer genuinely has sections. Do not format a two-sentence answer.

HONESTY
- Never invent a metric, an order, a visitor count, a benchmark or a competitor's number. If you were not given it, say you cannot see it and say what would tell you.
- Do not flatter. If the catalogue is wrong for the audience, if the price is unserious, if the store is not ready to launch — say it plainly and say what to do instead.
- Uncertainty is allowed. "I'd guess X, but I can't see Y" is a better answer than false confidence.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world". No hype, no exclamation marks.

CHANGING THE STORE
- When the founder asks you to change something, use the propose_store_edit tool. Write your reply FIRST — what you're changing and why — then call the tool once. The founder sees an Apply button and decides.
- Change only what was asked. A request to warm the accent is not licence to restyle the store.
- Do the creative work properly. Write the actual headline, the actual product, the actual hex. Never propose a placeholder.
- For a question, advice, or anything ambiguous, do NOT call the tool. Answer, and offer the change as a next step.
- Store content you write (name, tagline, product copy, announcement) stays in the store's existing language unless the founder asks you to change it.

LANGUAGE
Reply in the SAME language the founder writes in — German, French, Spanish, Portuguese, Italian, Dutch, Arabic, Hindi, Japanese, anything — fluently, in this same hype-free voice. The banned words above describe a tone to avoid in every language, not just English. Fall back to English only if their language is genuinely unclear.`;

/**
 * Stream a grounded assistant turn.
 *
 * Yields typed events rather than raw text so the rail can render the reply as
 * it arrives, show the reasoning phase honestly, and surface a proposed edit as
 * a card the founder approves.
 */
export async function* streamAssistant(
  apiKey: string,
  history: AssistantMessage[],
  context: AssistantContext,
  /**
   * Files attached to THIS turn — a screenshot to critique, a logo to react to,
   * a supplier PDF to read.
   *
   * They are placed on the final user message only, never replayed into
   * history. Re-sending a 3 MB screenshot on every subsequent turn would
   * multiply the cost of a conversation by its length and, worse, leave the
   * model looking at an image the founder has long since moved on from.
   */
  attachments?: Attachment[],
): AsyncGenerator<AssistantEvent, void, unknown> {
  const client = new Anthropic({ apiKey });

  // Bound the input: turn count, total characters, and per message. With
  // max_tokens bounding the other end, the worst-case cost of a turn is fixed
  // regardless of how long a founder lets a conversation run (spec 6.2).
  const bounded = boundHistory(
    history,
    AI_INPUT_BUDGET.askMaxTurns,
    AI_INPUT_BUDGET.askHistoryChars,
  );
  const lastIndex = bounded.length - 1;
  const turns: Anthropic.MessageParam[] = bounded.map((m, i) => {
    const text = clampText(m.content, AI_INPUT_BUDGET.askPerMessageChars);
    const isCurrentTurn = i === lastIndex && m.role === "user";
    return {
      role: m.role,
      content: (isCurrentTurn
        ? buildUserContent(text, attachments)
        : text) as Anthropic.MessageParam["content"],
    };
  });

  const stream = client.messages.stream({
    model: ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    // Adaptive thinking: a headline rewrite spends almost nothing on reasoning,
    // a "why is nobody buying" gets the room it needs. The model decides.
    thinking: { type: "adaptive" },
    tools: [PROPOSE_EDIT_TOOL],
    system: [
      // The prompt is stable across every turn, so it is worth caching; the
      // business snapshot changes and is not.
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: renderContext(context) },
    ],
    messages: turns,
  });

  let phase: "thinking" | "writing" | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "message_start") {
      inputTokens = event.message.usage?.input_tokens ?? 0;
      outputTokens = event.message.usage?.output_tokens ?? 0;
    } else if (event.type === "message_delta") {
      outputTokens = event.usage?.output_tokens ?? outputTokens;
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "thinking_delta") {
        // The reasoning itself is not shown — it is not written for the founder
        // — but the fact that Urivo is reasoning is worth showing honestly.
        if (phase !== "thinking") {
          phase = "thinking";
          yield { type: "phase", phase };
        }
      } else if (event.delta.type === "text_delta") {
        if (phase !== "writing") {
          phase = "writing";
          yield { type: "phase", phase };
        }
        yield { type: "text", text: event.delta.text };
      }
    }
  }

  // The tool input is read from the completed message rather than reassembled
  // from partial JSON deltas: a proposal is only meaningful once whole.
  const final = await stream.finalMessage();
  for (const block of final.content) {
    if (block.type !== "tool_use" || block.name !== PROPOSE_EDIT_TOOL.name) continue;
    const parsed = AIEditPlanSchema.safeParse(block.input);
    // A malformed proposal is dropped, not surfaced. The founder still has the
    // written answer; they have simply not been offered a button that would
    // apply something the model did not express correctly.
    if (parsed.success) yield { type: "edit", edit: parsed.data };
  }

  yield { type: "usage", usage: { inputTokens, outputTokens } };
}
