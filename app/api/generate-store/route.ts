import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCreditBalance, STORE_GENERATION_COST } from "@/lib/credits";
import { rateLimit } from "@/lib/ratelimit";
import {
  generateStore,
  STORE_GENERATOR_MODEL,
  STORE_GENERATOR_PROMPT_VERSION,
} from "@/lib/ai/store-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  // Rate limit: generation is expensive. 5 per minute per user.
  const limit = await rateLimit(`generate:${user.id}`, 5, 60_000);
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
    return fail(502, "AI_FAILED", "Generation hit a snag. Your credits were not used — please try again.");
  }

  // 6. Atomic persist: deduct credits + create store + products + audit
  const themeConfig = {
    tagline: generated.brand.tagline,
    typography: {
      primaryHeader: generated.brand.headingFont,
      secondaryBody: generated.brand.bodyFont,
    },
    palette: {
      primaryBackground: generated.brand.background,
      secondaryStructure: generated.brand.structure,
      accentConversion: generated.brand.accent,
    },
    generation: {
      model: STORE_GENERATOR_MODEL,
      promptVersion: STORE_GENERATOR_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    },
  };

  const products = generated.products.map((p) => ({
    title: p.title,
    description: p.description,
    price_eur: p.priceEUR,
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
    return fail(500, "INTERNAL", "Could not finish creating your store. Please try again.");
  }

  const result = rpcResult as { store_id: string; credits_remaining: number };
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const storeUrl = rootDomain.startsWith("localhost")
    ? `/store/${body.subdomain}`
    : `https://${body.subdomain}.${rootDomain}`;

  return NextResponse.json({
    success: true,
    storeId: result.store_id,
    subdomain: body.subdomain,
    storeUrl,
    storeName: generated.brand.name,
    creditsRemaining: result.credits_remaining,
  });
}
