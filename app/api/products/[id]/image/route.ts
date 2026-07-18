import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { parseTheme } from "@/lib/storefront";
import { parseDesignSystem, themeToDesignSystem } from "@/lib/storefront/design-system";
import {
  generateSingleProductImage,
  isImageGenerationConfigured,
} from "@/lib/ai/image-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Regenerate (or clear) a single product's photograph from the store manager.
 * Ownership is verified first; generation reuses the store's own design system
 * so the new shot matches the brand. Best-effort — a failure leaves the existing
 * image untouched.
 */

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

async function authorizeProduct(productId: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, reason: "UNAUTHORIZED" as const };

  const { data: product } = await supabaseAdmin()
    .from("products")
    .select("id, title, description, store_id, stores(user_id, subdomain, theme_config)")
    .eq("id", productId)
    .maybeSingle();

  const rel = product?.stores as
    | { user_id: string; subdomain: string; theme_config: unknown }
    | { user_id: string; subdomain: string; theme_config: unknown }[]
    | null
    | undefined;
  const store = Array.isArray(rel) ? rel[0] : rel;
  if (!product || !store || store.user_id !== user.id) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }
  return { ok: true as const, user, product, store };
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await authorizeProduct(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Product not found.");
  }

  if (!isImageGenerationConfigured()) {
    return fail(503, "IMAGE_UNAVAILABLE", "Image generation isn't set up yet. Add a Higgsfield API key to enable it.");
  }

  const limit = await rateLimit(`product-image:${auth.user.id}`, 20, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're regenerating images very quickly. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const requestId = newRequestId();
  const config = (auth.store.theme_config ?? {}) as Record<string, unknown>;
  const ds = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(auth.store.theme_config));

  let imageUrl: string | null = null;
  try {
    imageUrl = await generateSingleProductImage(auth.store.subdomain, ds, {
      title: auth.product.title,
      description: auth.product.description,
      priceEUR: 0,
    });
  } catch (err) {
    captureException(err, { requestId, userId: auth.user.id, route: "product-image" });
  }

  if (!imageUrl) {
    return fail(502, "IMAGE_FAILED", "Couldn't generate an image just now. Please try again.");
  }

  const { error } = await supabaseAdmin()
    .from("products")
    .update({ image_url: imageUrl })
    .eq("id", id);
  if (error) {
    return fail(500, "INTERNAL", "Generated the image but couldn't save it. Please try again.");
  }

  return NextResponse.json({ success: true, imageUrl });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeProduct(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Product not found.");
  }

  const { error } = await supabaseAdmin().from("products").update({ image_url: null }).eq("id", id);
  if (error) return fail(500, "INTERNAL", "Could not remove the image. Please try again.");
  return NextResponse.json({ success: true });
}
