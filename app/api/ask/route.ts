import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AttachmentsSchema, acceptAttachments } from "@/lib/ai/attachments-schema";
import { supabaseServer } from "@/lib/supabase/server";
import { getPlanForUser } from "@/lib/plan-access";
import { getCreditBalance, spendCredits } from "@/lib/credits";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { streamAssistant, ASSISTANT_MODEL } from "@/lib/ai/assistant";
import { loadAssistantContext, type AssistantContext } from "@/lib/ai/context";
import { recordAiUsage } from "@/lib/finance/ledger";
import type { TokenUsage } from "@/lib/finance/cost-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * "Ask Urivo" — the single conversation endpoint.
 *
 * Streams newline-delimited JSON events so the rail can render prose as it
 * arrives, show the reasoning phase, and surface a proposed store change as a
 * card the founder approves. One endpoint whether or not a store exists: the
 * assistant's grounding changes, its capability does not.
 *
 * Grounding is loaded server-side from the authenticated user's own data and is
 * never accepted from the client.
 */

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24),
  /* Files attached to this turn only — never replayed into history. */
  attachments: AttachmentsSchema,
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "UNAUTHORIZED", "Please sign in to use Ask Urivo.");

  // The AI Store Assistant is a paid capability (Founder and Pro).
  const plan = await getPlanForUser(user.id);
  if (!plan.features.askUrivo) {
    return fail(
      403,
      "UPGRADE_REQUIRED",
      "The AI Store Assistant is available on Founder and Pro. Upgrade to chat with Urivo.",
    );
  }

  // Priority made concrete: higher tiers get a wider per-minute lane.
  const limit = await rateLimit(`ask:${user.id}`, plan.askPerMinute, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're sending messages very quickly. Give it a second." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(503, "AI_UNAVAILABLE", "Ask Urivo isn't available just yet. Please try again shortly.");
  }

  // Every Ask Urivo message costs credits. Verify up front; charge after success.
  const balance = await getCreditBalance(user.id).catch(() => 0);
  if (balance < CREDIT_COSTS.askMessage) {
    return fail(402, "INSUFFICIENT_CREDITS", "You're out of credits. Upgrade or top up to keep chatting with Urivo.");
  }

  const requestId = newRequestId();
  let context: AssistantContext;
  try {
    context = await loadAssistantContext(user.id);
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "ask:context" });
    // Non-fatal: an ungrounded answer beats a failed conversation. The prompt
    // forbids inventing numbers, so a missing snapshot costs specificity only.
    context = {
      store: null,
      metrics: null,
      account: { plan: plan.name, credits: balance, storeCount: 0, canTakePayments: false },
      unavailable: true,
    };
  }

  /*
   * Re-validated server-side against the byte limits, not just the shape. The
   * browser already checked, but the browser is not the boundary — anything
   * over the limit is dropped rather than failing the turn, so six good
   * screenshots and one enormous one still gets an answer about the six.
   */
  const { attachments } = acceptAttachments(body.attachments);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      let usage: TokenUsage | null = null;
      let produced = false;
      try {
        for await (const event of streamAssistant(apiKey, body.messages, context, attachments)) {
          if (event.type === "usage") {
            usage = event.usage;
            continue;
          }
          if (event.type === "edit") {
            produced = true;
            /*
             * Name the store the proposal was reasoned about. The rail and this
             * route each pick "the founder's top store" independently; if those
             * rules ever drift, an Apply button would write a change to a
             * different store than the one Urivo was looking at. Carrying the
             * id makes that impossible rather than merely unlikely.
             */
            send({ ...event, storeId: context.store?.id ?? null });
            continue;
          }
          if (event.type === "text") produced = true;
          send(event);
        }

        // Charge for the completed turn BEFORE closing the stream — after
        // close() a serverless function may freeze before the charge runs. A
        // turn that produced nothing is not charged (spec 6.2 §19).
        if (produced) {
          try {
            await spendCredits(user.id, CREDIT_COSTS.askMessage, "Ask Urivo message", "ask");
            await recordAiUsage({
              userId: user.id,
              feature: "askMessage",
              credits: CREDIT_COSTS.askMessage,
              usage: usage ?? undefined,
              model: ASSISTANT_MODEL,
              requestId,
            });
          } catch (err) {
            captureException(err, { requestId, userId: user.id, route: "ask:charge" });
          }
        }
      } catch (err) {
        captureException(err, { requestId, userId: user.id, route: "ask" });
        // Reported in-band so a mid-stream failure is visible as an error the
        // founder can retry, not as prose appended to a half-written answer.
        send({
          type: "error",
          message: produced
            ? "That response was cut short. Retry to pick it up again."
            : "Ask Urivo couldn't answer that just now. Please try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
