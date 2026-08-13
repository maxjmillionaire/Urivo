import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ProductUpdateSchema } from "@/lib/validation";
import { revalidateStoreById } from "@/lib/storefront/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Confirm the caller is signed in AND owns the product's parent store.
 * Auth is checked first (spec 6.3 pipeline order) so anonymous requests get
 * a uniform 401 and cannot enumerate which product ids exist.
 */
async function authorizeProduct(productId: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, reason: "UNAUTHORIZED" as const };

  const { data: product } = await supabaseAdmin()
    .from("products")
    .select("store_id, stores(user_id)")
    .eq("id", productId)
    .maybeSingle();

  // PostgREST types an embedded to-one relation as an array; normalize it.
  const rel = product?.stores as
    | { user_id: string }
    | { user_id: string }[]
    | null
    | undefined;
  const ownerId = Array.isArray(rel) ? rel[0]?.user_id : rel?.user_id;
  if (!product || ownerId !== user.id) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }
  // The store id rides along so writers can bust that storefront's cache.
  return { ok: true as const, storeId: product.store_id as string };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authorizeProduct(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Product not found.");
  }

  let body: z.infer<typeof ProductUpdateSchema>;
  try {
    body = ProductUpdateSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.priceEUR !== undefined) update.price_eur = body.priceEUR;
  if (body.inventoryCount !== undefined) update.inventory_count = body.inventoryCount;
  if (body.showLogo !== undefined) update.show_logo = body.showLogo;

  /*
   * GPSR Art. 19. An empty string is stored as NULL rather than as "": the
   * completeness rule in lib/commerce/gpsr.ts treats blank as missing, and
   * keeping one representation of "not supplied" means the dashboard, the
   * storefront and the database cannot disagree about whether a field is filled.
   */
  const GPSR = [
    ["manufacturerName", "manufacturer_name"],
    ["manufacturerAddress", "manufacturer_address"],
    ["manufacturerEmail", "manufacturer_email"],
    ["euResponsibleName", "eu_responsible_name"],
    ["euResponsibleAddress", "eu_responsible_address"],
    ["euResponsibleEmail", "eu_responsible_email"],
    ["productIdentifier", "product_identifier"],
    ["safetyWarnings", "safety_warnings"],
  ] as const;
  for (const [key, column] of GPSR) {
    const value = body[key];
    if (value !== undefined) update[column] = value.length > 0 ? value : null;
  }
  if (Object.keys(update).length === 0) {
    return fail(400, "INVALID_INPUT", "Nothing to update.");
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id)
    .select("id, title, description, price_eur, inventory_count, show_logo")
    .single();

  if (error) {
    return fail(500, "INTERNAL", "Could not save the product. Please try again.");
  }
  // The catalogue changed — the live storefront must not serve the old one.
  await revalidateStoreById(auth.storeId);

  return NextResponse.json({ success: true, product: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authorizeProduct(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Product not found.");
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    return fail(500, "INTERNAL", "Could not remove the product. Please try again.");
  }
  // The catalogue changed — the live storefront must not serve the old one.
  await revalidateStoreById(auth.storeId);

  return NextResponse.json({ success: true });
}
