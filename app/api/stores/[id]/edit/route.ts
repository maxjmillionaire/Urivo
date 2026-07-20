import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireStoreOwner } from "@/lib/tenant";
import { getPlanForUser } from "@/lib/plan-access";
import { getCreditBalance, spendCredits } from "@/lib/credits";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { proposeStoreEdit } from "@/lib/ai/store-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * "Ask Urivo" — propose a conversational edit to a store. Returns a plain reply
 * and, when the founder asked for a change, a structured plan to confirm. Applying
 * happens separately (edit/apply) so the founder always stays in control.
 */

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(20),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  // The AI Store Assistant is a paid capability (Founder and Elite).
  const plan = await getPlanForUser(owner.userId);
  if (!plan.features.askUrivo) {
    return fail(
      403,
      "UPGRADE_REQUIRED",
      "The AI Store Assistant is available on Founder and Elite. Upgrade to edit with Urivo.",
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "AI_UNAVAILABLE", "Ask Urivo isn't available just yet. Please try again shortly.");

  // Every Ask Urivo message costs credits. Verify up front; charge after success.
  const balance = await getCreditBalance(owner.userId).catch(() => 0);
  if (balance < CREDIT_COSTS.askMessage) {
    return fail(402, "INSUFFICIENT_CREDITS", "You're out of credits. Upgrade or top up to keep editing with Urivo.");
  }

  const limit = await rateLimit(`edit:${owner.userId}`, plan.askPerMinute, 60_000);
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
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const supabase = await supabaseServer();
  const [{ data: store }, { data: products }] = await Promise.all([
    supabase.from("stores").select("store_name, theme_config").eq("id", id).single(),
    supabase.from("products").select("title, description, price_eur").eq("store_id", id).order("position", { ascending: true }),
  ]);
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));

  const requestId = newRequestId();
  try {
    const result = await proposeStoreEdit(apiKey, {
      name: store.store_name,
      tagline: ds.tagline ?? "",
      ds,
      products: (products ?? []).map((p) => ({
        title: p.title,
        description: p.description ?? "",
        priceEUR: Number(p.price_eur),
      })),
    }, body.messages);
    // Charge for the completed message (spec 6.2 §19: a failed call never costs).
    await spendCredits(owner.userId, CREDIT_COSTS.askMessage, "Ask Urivo message", "ask").catch((e) =>
      captureException(e, { requestId, userId: owner.userId, route: "store-edit:charge" }),
    );
    return NextResponse.json({ reply: result.reply, edit: result.edit });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't do that one — try describing it differently.");
    captureException(err, { requestId, userId: owner.userId, route: "store-edit" });
    return fail(502, "AI_FAILED", "That hit a snag. Please try again.");
  }
}
