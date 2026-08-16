import { NextResponse, type NextRequest } from "next/server";
import { acceptAttachments } from "@/lib/ai/attachments-schema";
import { loadAdPerformance } from "@/lib/ai/ad-context";
import {
  saveCreatives,
  loadAdPerformanceHistory,
  loadAdLibrary,
  detectTrackingGap,
  loadAttributionCoverage,
  explainCoverage,
} from "@/lib/ai/ad-performance";
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

/**
 * Every ad this store has generated: its copy, its tracking link, and what it
 * measurably did.
 *
 * Exact, not sampled: Urivo owns the storefront that received the click and
 * the order that closed the sale, so the join is two rows in one database.
 * No pixel to be blocked, no third party, no consent banner for a tracker
 * that does not exist.
 *
 * The tracking links belong here rather than only in the generation response.
 * Ads are written in one sitting and launched in another; a merchant who comes
 * back a day later must be able to reach the link that makes the measurement
 * work, without paying credits to regenerate ads they already have.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const supabase = await supabaseServer();
  const { data: store } = await supabase.from("stores").select("subdomain").eq("id", id).single();
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  const [creatives, performance, coverage] = await Promise.all([
    loadAdLibrary(id, store.subdomain, process.env.APP_URL ?? "http://localhost:3000"),
    loadAdPerformance(id),
    loadAttributionCoverage(id, 30),
  ]);

  return NextResponse.json({
    creatives,
    // Whether the one manual step in the chain — pasting the tracked link into
    // the ad platform — actually happened. Silent otherwise.
    tracking: detectTrackingGap(creatives, performance.visitors7d),
    /*
     * Never send ad figures without the share of revenue they account for
     * (spec 10 §14). A merchant reading "€258" concludes their ads produced
     * €258; reading it beside €340 they could not be credited, they reason
     * correctly about what they actually know.
     */
    coverage,
    coverageNote: explainCoverage(coverage),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    supabase.from("stores").select("store_name, subdomain, theme_config").eq("id", id).single(),
    supabase.from("products").select("title, description, price_eur").eq("store_id", id).order("position", { ascending: true }),
  ]);
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));

  /*
   * The body is optional: Ad Studio has always been a one-click action, and it
   * stays one. Attachments only appear when the merchant actually chose some,
   * so an empty POST keeps working exactly as before.
   */
  const { attachments } = acceptAttachments(
    await request.json().then((b) => (b as { attachments?: unknown })?.attachments).catch(() => undefined),
  );

  // The store's real traffic and sales. Ad Studio wrote ads from a catalogue
  // until now; these are the numbers that change the advice.
  const [performance, history] = await Promise.all([
    loadAdPerformance(id),
    // What previous ads for this store actually did. Empty on the first run.
    loadAdPerformanceHistory(id),
  ]);

  const requestId = newRequestId();
  try {
    const { plan, usage, adjusted } = await generateAdPlan(apiKey, {
      name: store.store_name,
      tagline: ds.tagline ?? "",
      personality: ds.personality,
      products: (products ?? []).map((p) => ({
        title: p.title,
        description: p.description ?? "",
        priceEUR: Number(p.price_eur),
      })),
    }, attachments, performance, history);
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
    // `adjusted` is empty on a clean run; when copy had to be cut to fit a
    // platform, the merchant is told rather than handed a silently shortened ad.
    /*
     * Persist the ads so their traffic and revenue can be attributed back to
     * them, and hand each one its tracking link. This is what turns a plan
     * into something measurable — without it the next run is another guess.
     *
     * Best-effort: a merchant who cannot be given links still gets their ads.
     */
    const stored = await saveCreatives(
      id,
      store.subdomain,
      plan.creatives,
      process.env.APP_URL ?? "http://localhost:3000",
    );

    // `adjusted` is empty on a clean run; when copy had to be cut to fit a
    // platform, the merchant is told rather than handed a silently shortened ad.
    return NextResponse.json({
      success: true,
      plan: stored ? { ...plan, creatives: stored } : plan,
      adjusted,
      tracked: Boolean(stored),
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't build ads for that one — try adjusting the store first.");
    captureException(err, { requestId, userId: owner.userId, route: "ads" });
    return fail(502, "AI_FAILED", "Ad Studio hit a snag. Please try again.");
  }
}
