import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStoreOwner } from "@/lib/tenant";
import { getPlanForUser } from "@/lib/plan-access";
import { getCreditBalance, spendCredits } from "@/lib/credits";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { supabaseServer } from "@/lib/supabase/server";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { parseTheme } from "@/lib/storefront";
import { draftCampaign, CAMPAIGN_MODEL } from "@/lib/marketing/campaign";
import { recordAiUsage } from "@/lib/finance/ledger";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Draft a campaign to the store's subscribers from the merchant's goal. One AI
 * call, priced like an Ask turn and charged only after it succeeds — a failed
 * draft never costs a credit. Owner-gated and paid-only, since a live store (and
 * therefore any subscribers) is itself a paid capability.
 */

const BodySchema = z.object({
  goal: z.string().trim().min(4, "Tell me what the email should do.").max(300),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStoreOwner(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const plan = await getPlanForUser(auth.userId);
  if (!plan.features.publish) {
    return fail(403, "UPGRADE_REQUIRED", "Email campaigns are available on Founder and Pro. Upgrade to reach your subscribers.");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "AI_UNAVAILABLE", "Drafting isn't available just now. Please try again shortly.");

  const balance = await getCreditBalance(auth.userId).catch(() => 0);
  if (balance < CREDIT_COSTS.campaignDraft) {
    return fail(402, "INSUFFICIENT_CREDITS", "You're out of credits. Upgrade or top up to draft a campaign.");
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  // Brand context, read through the owner's client (RLS-scoped to this store).
  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("store_name, theme_config")
    .eq("id", id)
    .single();
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));
  const { data: products } = await supabase
    .from("products")
    .select("title, price_eur")
    .eq("store_id", id)
    .order("position", { ascending: true })
    .limit(8);

  const requestId = newRequestId();
  let out;
  try {
    out = await draftCampaign({
      storeName: store.store_name as string,
      tagline: ds.tagline ?? null,
      personality: ds.personality,
      products: (products ?? []).map((p) => ({ title: p.title as string, priceEUR: Number(p.price_eur) })),
      goal: body.goal,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_REFUSED") {
      return fail(422, "AI_REFUSED", "I couldn't write that one. Try describing the email differently.");
    }
    captureException(err, { requestId, userId: auth.userId, route: "campaigns:draft" });
    return fail(502, "AI_FAILED", "Drafting hit a snag. Your credits were not used — please try again.");
  }

  // Charge only after a successful draft, then record the real cost. Best-effort.
  try {
    await spendCredits(auth.userId, CREDIT_COSTS.campaignDraft, "Campaign draft", "campaign");
    await recordAiUsage({
      userId: auth.userId,
      feature: "campaignDraft",
      credits: CREDIT_COSTS.campaignDraft,
      usage: out.usage,
      model: CAMPAIGN_MODEL,
      requestId,
    });
  } catch (err) {
    captureException(err, { requestId, userId: auth.userId, route: "campaigns:draft:charge" });
  }

  return NextResponse.json({ subject: out.subject, body: out.body });
}
