import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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
  // plan's priority — higher tiers wait less (Founder/Elite get a wider lane).
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

  // 5. Generate (AI)
  let generated;
  try {
    generated = await generateStore({ prompt: body.prompt });
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

  // Publishing (going live) is a paid capability. Stores are created live by
  // default, so on a plan that can't publish we start the new store as a draft —
  // the owner can preview and edit it, and upgrade to take it public.
  const published = plan.features.publish;
  if (!published) {
    await admin.from("stores").update({ is_active: false }).eq("id", result.store_id);
  }

  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const storeUrl = rootDomain.startsWith("localhost")
    ? `/store/${body.subdomain}`
    : `https://${body.subdomain}.${rootDomain}`;

  return NextResponse.json({
    success: true,
    storeId: result.store_id,
    subdomain: body.subdomain,
    storeUrl,
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
}
