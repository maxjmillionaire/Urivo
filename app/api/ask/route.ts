import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";
import { getPlanForUser } from "@/lib/plan-access";
import { getCreditBalance, spendCredits } from "@/lib/credits";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import {
  streamAssistantReply,
  type StoreContext,
} from "@/lib/ai/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * "Ask Urivo" conversation endpoint (companion rail).
 *
 * Streams a grounded, store-aware assistant reply as text/plain chunks so the
 * rail renders token-by-token. Grounding context is loaded server-side from the
 * authenticated user's active store — never trusted from the client.
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
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

async function loadStoreContext(userId: string): Promise<StoreContext | null> {
  const supabase = await supabaseServer();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, store_name, subdomain, is_active, theme_config, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!stores || stores.length === 0) return null;

  const top = stores.find((s) => s.is_active) ?? stores[0];
  const theme = parseTheme(top.theme_config);
  const { data: products } = await supabase
    .from("products")
    .select("title, description, price_eur")
    .eq("store_id", top.id)
    .order("position", { ascending: true })
    .limit(8);

  return {
    name: top.store_name,
    subdomain: top.subdomain,
    tagline: theme.tagline,
    isLive: top.is_active,
    palette: { background: theme.background, structure: theme.structure, accent: theme.accent },
    products: (products ?? []).map((p) => ({
      title: p.title,
      description: p.description,
      priceEUR: Number(p.price_eur),
    })),
  };
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "UNAUTHORIZED", "Please sign in to use Ask Urivo.");

  // The AI Store Assistant is a paid capability (Founder and Elite).
  const plan = await getPlanForUser(user.id);
  if (!plan.features.askUrivo) {
    return fail(
      403,
      "UPGRADE_REQUIRED",
      "The AI Store Assistant is available on Founder and Elite. Upgrade to chat with Urivo.",
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
  let store: StoreContext | null = null;
  try {
    store = await loadStoreContext(user.id);
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "ask" });
    // Non-fatal: continue without grounding rather than failing the chat.
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamAssistantReply(apiKey, body.messages, store)) {
          controller.enqueue(encoder.encode(chunk));
        }
        // Charge for the completed message BEFORE closing the stream — after
        // close() a serverless function may freeze before the charge runs.
        // A failed message never reaches here, so it never costs (spec 6.2 §19).
        try {
          await spendCredits(user.id, CREDIT_COSTS.askMessage, "Ask Urivo message", "ask");
        } catch (err) {
          captureException(err, { requestId, userId: user.id, route: "ask:charge" });
        }
      } catch (err) {
        captureException(err, { requestId, userId: user.id, route: "ask" });
        controller.enqueue(
          encoder.encode("\n\nSomething interrupted that response. Please try again."),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
