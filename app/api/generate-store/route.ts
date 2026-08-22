import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AttachmentsSchema, acceptAttachments } from "@/lib/ai/attachments-schema";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCreditBalance, STORE_GENERATION_COST } from "@/lib/credits";
import { getPlanForUser } from "@/lib/plan-access";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import {
  generateStore,
  STORE_GENERATOR_MODEL,
  STORE_GENERATOR_PROMPT_VERSION,
} from "@/lib/ai/store-generator";
import { generateStoreImagery } from "@/lib/ai/image-generator";
import {
  GEN_TTL_SECONDS,
  idempotencyKey,
  maxConcurrentGenerations,
  decideClaim,
  GUARD_UNAVAILABLE,
  type ClaimRow,
  type ClaimDecision,
} from "@/lib/ai/generation-guard";
import { recordAiUsage } from "@/lib/finance/ledger";
import { getPlatformSettings } from "@/lib/platform/settings";
import { maybeAlertSpend } from "@/lib/platform/spend-alert";
import { notifyLowCredits, notifyFirstStore } from "@/lib/notifications/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Store generation pipeline (spec 6.3 §21):
 *   authenticate → validate → check subdomain → verify credits →
 *   generate (AI) → validate output → atomic persist (credits+store+products+audit)
 *
 * Credits are deducted only inside the atomic RPC, which runs AFTER a
 * successful generation — a failed generation never costs the user (spec 6.2 §19).
 */

const BodySchema = z.object({
  prompt: z.string().trim().min(8, "Tell us a little more about your idea.").max(500),
  /*
   * An existing logo, moodboard, palette or packaging shot. The generator is
   * what invents the brand, so this is the only place an uploaded identity can
   * change the outcome — a merchant who already has a logo gets a store built
   * around it rather than one they have to fight to make match.
   */
  attachments: AttachmentsSchema,
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/,
      "Use 3–63 letters, numbers or hyphens.",
    ),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** The public URL for a generated store — same shape for the normal and the
 *  idempotent-replay responses. */
function storeUrlFor(subdomain: string): string {
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  return rootDomain.startsWith("localhost")
    ? `/store/${subdomain}`
    : `https://${subdomain}.${rootDomain}`;
}

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail(401, "UNAUTHORIZED", "Please sign in to generate a store.");
  }

  // Rate limit: generation is expensive. The per-minute lane scales with the
  // plan's priority — higher tiers wait less (Founder/Pro get a wider lane).
  const plan = await getPlanForUser(user.id);
  const limit = await rateLimit(`generate:${user.id}`, plan.generationsPerMinute, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "You're generating very quickly. Please wait a moment and try again.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // 1b. Free-tier kill switch (cost control). When free generations are paused,
  // free accounts see an honest capacity state; paying accounts are unaffected.
  if (plan.key === "free") {
    const settings = await getPlatformSettings();
    if (!settings.freeGenerationsEnabled) {
      return fail(
        503,
        "FREE_GENERATIONS_PAUSED",
        "Free store generation is paused while we scale up capacity. Upgrade to generate now, or check back shortly.",
      );
    }
  }

  // 2. Validate request
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message ?? "Invalid request."
        : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const admin = supabaseAdmin();

  // 3. Subdomain availability (reserved + uniqueness)
  const { data: reserved } = await admin
    .from("reserved_subdomains")
    .select("subdomain")
    .eq("subdomain", body.subdomain)
    .maybeSingle();
  if (reserved) {
    return fail(409, "SUBDOMAIN_TAKEN", "That address is reserved. Try another.");
  }
  const { data: existing } = await admin
    .from("stores")
    .select("id")
    .eq("subdomain", body.subdomain)
    .maybeSingle();
  if (existing) {
    return fail(409, "SUBDOMAIN_TAKEN", "That address is already taken. Try another.");
  }

  // 4. Verify credits before the expensive AI call
  let balance: number;
  try {
    balance = await getCreditBalance(user.id);
  } catch {
    return fail(500, "INTERNAL", "Could not verify your credits. Please try again.");
  }
  if (balance < STORE_GENERATION_COST) {
    return fail(402, "INSUFFICIENT_CREDITS", "You don't have enough credits for a new store.");
  }

  const requestId = newRequestId();

  /*
   * Task 3 — claim a durable generation slot BEFORE any expensive work.
   *
   * The per-user concurrency lock + idempotency + global ceiling from migration
   * 0059 (Postgres, not a queue). A refused claim is controlled backpressure
   * (429/409 + Retry-After), never a 500.
   *
   * FAILS CLOSED. The guard is a hard prerequisite, not best-effort: if the
   * claim RPC errors, returns nothing, or gives an outcome we can't act on, we
   * do NOT enter the expensive Anthropic/Higgsfield/Gemini pipeline — we return a
   * retryable 503 with Retry-After. The expensive path is never run without a
   * verified lock.
   */
  const idemKey = idempotencyKey(request.headers.get("Idempotency-Key"), body.subdomain);
  const maxGlobal = maxConcurrentGenerations(process.env.URIVO_MAX_CONCURRENT_GENERATIONS);

  let decision: ClaimDecision;
  try {
    const { data: claimRows, error: claimErr } = await admin.rpc("claim_generation_job", {
      p_user_id: user.id,
      p_key: idemKey,
      p_subdomain: body.subdomain,
      p_ttl_seconds: GEN_TTL_SECONDS,
      p_max_global: maxGlobal,
    });
    if (claimErr) {
      captureException(new Error(claimErr.message), { requestId, userId: user.id, route: "generate-store:claim" });
    }
    decision = decideClaim(!!claimErr, (claimRows as ClaimRow[] | null) ?? null);
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "generate-store:claim" });
    decision = { kind: "fail_closed", reason: "claim_exception" };
  }

  if (decision.kind === "replay") {
    // Idempotent replay — a prior identical request already built this store.
    return NextResponse.json({ success: true, storeId: decision.storeId, subdomain: body.subdomain, storeUrl: storeUrlFor(body.subdomain), duplicate: true });
  }
  if (decision.kind === "backpressure" || decision.kind === "fail_closed") {
    const bp = decision.kind === "backpressure" ? decision.response : GUARD_UNAVAILABLE;
    return NextResponse.json(
      { error: bp.error, message: bp.message },
      { status: bp.status, headers: { "Retry-After": String(bp.retryAfter) } },
    );
  }
  // decision.kind === "proceed" — the only path into the expensive pipeline.
  const jobId: string = decision.jobId;

  // Everything expensive runs inside this block; the finally releases the job
  // lock exactly once — 'succeeded' with the new store, or 'failed' on any exit
  // (error return or throw). A failed generation charged nothing (credits are
  // deducted only inside generate_store_atomic on success), so there is nothing
  // to refund — releasing the lock is the whole cleanup.
  let jobSucceeded = false;
  let jobStoreId: string | null = null;
  try {
    /*
     * Start of the clock the landing page is making a promise about — the
     * generation itself (model + imagery), not Urivo's auth/plan/lock overhead.
     */
    const startedAt = Date.now();

    // 5. Generate (AI)
    let generated;
    try {
      generated = await generateStore({
      prompt: body.prompt,
      attachments: acceptAttachments(body.attachments).attachments,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_NOT_CONFIGURED") {
      return fail(503, "AI_UNAVAILABLE", "Store generation is not available yet. Please try again shortly.");
    }
    if (code === "AI_REFUSED") {
      return fail(422, "AI_REFUSED", "We couldn't design a store from that idea. Try describing it differently.");
    }
    // AI_INVALID_OUTPUT or provider error — credits untouched.
    captureException(err, { requestId, userId: user.id, route: "generate-store" });
    return fail(502, "AI_FAILED", "Generation hit a snag. Your credits were not used — please try again.");
  }

  // 6. Atomic persist: deduct credits + create store + products + audit.
  // The full design system is the source of truth for the storefront; a legacy
  // palette/tagline mirror is kept so the dashboard rail preview keeps working.
  const ds = generated.designSystem;
  const themeConfig = {
    tagline: generated.brand.tagline,
    designSystem: ds,
    palette: {
      primaryBackground: ds.palette.background,
      secondaryStructure: ds.palette.ink,
      accentConversion: ds.palette.accent,
    },
    generation: {
      model: STORE_GENERATOR_MODEL,
      promptVersion: STORE_GENERATOR_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    },
  };

  // 5b. Product photography (best-effort). Runs after a successful generation;
  // never blocks or fails store creation — a missing image just falls back to
  // the storefront's palette plane.
  let imageUrls: (string | null)[] = generated.products.map(() => null);
  try {
    imageUrls = await generateStoreImagery(body.subdomain, ds, generated.products);
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "generate-store:imagery" });
  }

  const products = generated.products.map((p, i) => ({
    title: p.title,
    description: p.description,
    price_eur: p.priceEUR,
    image_url: imageUrls[i] ?? null,
    // Provenance recorded at the moment of creation — the disclosure on the
    // storefront is only as honest as this field (EU AI Act Art. 50).
    image_source: imageUrls[i] ? "ai" : null,
    inventory_count: 100,
  }));

  const { data: rpcResult, error: rpcError } = await admin.rpc(
    "generate_store_atomic",
    {
      p_user_id: user.id,
      p_store_name: generated.brand.name,
      p_subdomain: body.subdomain,
      p_theme_config: themeConfig,
      p_products: products,
      p_credit_cost: STORE_GENERATION_COST,
      /*
       * Whether this store is born live (migration 0055).
       *
       * `stores.is_active` defaults to true, so until 0055 every generated store
       * was live on creation for every plan — the free tier got a live store on
       * a urivo.ai address without ever touching the publish button, and
       * publish_store, which holds both the capacity rule and the paid-capability
       * rule, was never on this path.
       *
       * `plan` here is the ENTITLED plan from getPlanForUser, resolved from
       * payment state rather than the plan column, so a checkout that never paid
       * cannot buy a live store.
       */
      p_is_active: plan.features.publish,
    },
  );

  if (rpcError) {
    const msg = rpcError.message || "";
    if (msg.includes("INSUFFICIENT_CREDITS")) {
      return fail(402, "INSUFFICIENT_CREDITS", "You don't have enough credits for a new store.");
    }
    if (msg.includes("SUBDOMAIN_RESERVED")) {
      return fail(409, "SUBDOMAIN_TAKEN", "That address is reserved. Try another.");
    }
    if (msg.includes("stores_subdomain_key") || msg.includes("duplicate key")) {
      return fail(409, "SUBDOMAIN_TAKEN", "That address was just taken. Try another.");
    }
    captureException(rpcError, { requestId, userId: user.id, route: "generate-store:persist" });
    return fail(500, "INTERNAL", "Could not finish creating your store. Please try again.");
  }

  const result = rpcResult as { store_id: string; credits_remaining: number };

  // Record the real cost of this generation (tokens + actual images produced)
  // for the finance ledger. Best-effort — never blocks the response.
  await recordAiUsage({
    userId: user.id,
    feature: "storeGeneration",
    credits: STORE_GENERATION_COST,
    usage: generated.usage,
    images: imageUrls.filter(Boolean).length,
    model: STORE_GENERATOR_MODEL,
    durationMs: Date.now() - startedAt,
    requestId,
  });

  // Spend guardrail (2.5): check the day's free-tier inference spend and alert
  // admins if it has crossed the threshold. Best-effort; never blocks.
  await maybeAlertSpend();

  // Operating-loop notifications (best-effort — never block the response).
  try {
    await notifyLowCredits(user.id, balance, result.credits_remaining);
    const { count: storeCount } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((storeCount ?? 0) <= 1) {
      await notifyFirstStore(user.id, result.store_id, generated.brand.name);
    }
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "generate-store:notify" });
  }

  // Publishing (going live) is a paid capability. Stores are created live by
  // default, so on a plan that can't publish we start the new store as a draft —
  // the owner can preview and edit it, and upgrade to take it public.
  const published = plan.features.publish;
  if (!published) {
    await admin.from("stores").update({ is_active: false }).eq("id", result.store_id);
  }

    // Mark the job succeeded before returning — the finally then records it with
    // the store id so a later identical request replays this store rather than
    // building another.
    jobSucceeded = true;
    jobStoreId = result.store_id;

    return NextResponse.json({
      success: true,
      storeId: result.store_id,
      subdomain: body.subdomain,
      storeUrl: storeUrlFor(body.subdomain),
      published,
      storeName: generated.brand.name,
      tagline: generated.brand.tagline,
      palette: {
        background: ds.palette.background,
        structure: ds.palette.ink,
        accent: ds.palette.accent,
      },
      products: generated.products.map((p) => ({ title: p.title, priceEUR: p.priceEUR })),
      creditsRemaining: result.credits_remaining,
    });
  } finally {
    // Release the generation lock exactly once, whichever way the block exited.
    if (jobId) {
      try {
        await admin.rpc("finish_generation_job", {
          p_job_id: jobId,
          p_status: jobSucceeded ? "succeeded" : "failed",
          p_store_id: jobStoreId,
        });
      } catch {
        /* releasing the lock is best-effort; a stale job self-expires anyway */
      }
    }
  }
}
