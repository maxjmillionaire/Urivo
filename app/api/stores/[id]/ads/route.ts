import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/tenant";
import { getCreditBalance, spendCredits } from "@/lib/credits";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import { generateAdPlan, AD_MODEL } from "@/lib/ai/ad-studio";
import { recordAiUsage } from "@/lib/finance/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Ad Studio — generate channel strategy + ad creative for a store. Auth +
 * ownership + rate-limited. Costs credits; charged only after a successful run.
 */

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "AI_UNAVAILABLE", "Ad Studio isn't available just yet. Please try again shortly.");

  const balance = await getCreditBalance(owner.userId).catch(() => 0);
  if (balance < CREDIT_COSTS.adStudio) {
    return fail(402, "INSUFFICIENT_CREDITS", "You're out of credits. Upgrade or top up to build an ad plan.");
  }

  const limit = await rateLimit(`ads:${owner.userId}`, 10, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're generating ads very quickly. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
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
    const { plan, usage } = await generateAdPlan(apiKey, {
      name: store.store_name,
      tagline: ds.tagline ?? "",
      personality: ds.personality,
      products: (products ?? []).map((p) => ({
        title: p.title,
        description: p.description ?? "",
        priceEUR: Number(p.price_eur),
      })),
    });
    await spendCredits(owner.userId, CREDIT_COSTS.adStudio, "Ad Studio plan", "ads").catch((e) =>
      captureException(e, { requestId, userId: owner.userId, route: "ads:charge" }),
    );
    await recordAiUsage({
      userId: owner.userId,
      feature: "adStudio",
      credits: CREDIT_COSTS.adStudio,
      usage,
      model: AD_MODEL,
      requestId,
    });
    return NextResponse.json({ success: true, plan });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't build ads for that one — try adjusting the store first.");
    captureException(err, { requestId, userId: owner.userId, route: "ads" });
    return fail(502, "AI_FAILED", "Ad Studio hit a snag. Please try again.");
  }
}
