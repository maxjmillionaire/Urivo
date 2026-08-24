import { NextResponse, type NextRequest } from "next/server";
import { requireStoreOwner } from "@/lib/tenant";
import { supabaseServer } from "@/lib/supabase/server";
import {
  shopifyProductCsv,
  shopifyExportFilename,
  type ExportableProduct,
} from "@/lib/commerce/shopify-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Export a store's products as a Shopify-import CSV — a portability / trust
 * feature. Owner-gated twice over: requireStoreOwner confirms ownership, and the
 * product read goes through the user's own client so RLS is an independent
 * boundary. An arbitrary store id belonging to another merchant resolves to
 * NOT_FOUND, never their data.
 *
 * Only product data the merchant created leaves — title, description, price,
 * image URL, inventory. No payout accounts, no Stripe ids, no private metadata.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStoreOwner(id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.reason === "UNAUTHORIZED" ? 401 : 404 },
    );
  }

  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("store_name, subdomain")
    .eq("id", id)
    .single();
  if (!store) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { data: products } = await supabase
    .from("products")
    .select("title, description, price_eur, image_url, inventory_count")
    .eq("store_id", id)
    .order("position", { ascending: true })
    .limit(5000);

  const rows: ExportableProduct[] = (products ?? []).map((p) => ({
    title: p.title as string,
    description: (p.description as string | null) ?? null,
    priceEUR: Number(p.price_eur),
    imageUrl: (p.image_url as string | null) ?? null,
    inventoryCount: Number(p.inventory_count ?? 0),
  }));

  const csv = shopifyProductCsv(store.store_name as string, rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // No charset-BOM: this file is for Shopify's importer, not Excel.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${shopifyExportFilename(store.subdomain as string)}"`,
      "Cache-Control": "no-store",
    },
  });
}
