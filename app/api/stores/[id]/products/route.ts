import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/tenant";
import { ProductCreateSchema } from "@/lib/validation";
import { GPSR_COLUMNS } from "@/lib/commerce/gpsr";
import { revalidateStoreById } from "@/lib/storefront/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Create a product in a store the caller owns. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await params;

  const owner = await requireStoreOwner(storeId);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  let body: z.infer<typeof ProductCreateSchema>;
  try {
    body = ProductCreateSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const supabase = await supabaseServer();

  // Append at the end of the catalog.
  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId);

  // RLS ("products: owner write") re-checks ownership at the row level.
  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: storeId,
      title: body.title,
      description: body.description,
      price_eur: body.priceEUR,
      inventory_count: body.inventoryCount,
      position: count ?? 0,
      // GPSR Art. 19 (0050). Blank stores as NULL so "not supplied" has one
      // representation across database, dashboard and storefront.
      ...Object.fromEntries(
        GPSR_COLUMNS.map(([field, column]) => [column, (body[field] ?? "").trim() || null]),
      ),
    })
    .select("id, title, description, price_eur, inventory_count")
    .single();

  if (error) {
    return fail(500, "INTERNAL", "Could not add the product. Please try again.");
  }
  // A new product must appear on the live storefront at once.
  await revalidateStoreById(storeId);

  return NextResponse.json({ success: true, product: data }, { status: 201 });
}
