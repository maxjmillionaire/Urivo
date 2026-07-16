import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/tenant";
import { StoreUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Update store name, tagline, palette, or active state (theme editor). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  let body: z.infer<typeof StoreUpdateSchema>;
  try {
    body = StoreUpdateSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const supabase = await supabaseServer();

  // Merge palette/tagline into the existing theme_config JSON.
  const { data: current } = await supabase
    .from("stores")
    .select("theme_config")
    .eq("id", id)
    .single();

  const theme = (current?.theme_config ?? {}) as Record<string, unknown>;
  const palette = (theme.palette ?? {}) as Record<string, unknown>;

  const nextTheme = {
    ...theme,
    ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
    palette: {
      ...palette,
      ...(body.background !== undefined ? { primaryBackground: body.background } : {}),
      ...(body.structure !== undefined ? { secondaryStructure: body.structure } : {}),
      ...(body.accent !== undefined ? { accentConversion: body.accent } : {}),
    },
  };

  const update: Record<string, unknown> = { theme_config: nextTheme };
  if (body.storeName !== undefined) update.store_name = body.storeName;
  if (body.isActive !== undefined) update.is_active = body.isActive;

  // RLS ("stores: own all") enforces ownership again at the row level.
  const { data, error } = await supabase
    .from("stores")
    .update(update)
    .eq("id", id)
    .select("id, store_name, subdomain, is_active, theme_config")
    .single();

  if (error) {
    return fail(500, "INTERNAL", "Could not save your changes. Please try again.");
  }
  return NextResponse.json({ success: true, store: data });
}

/** Delete a store (and its products, via ON DELETE CASCADE). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("stores").delete().eq("id", id);
  if (error) {
    return fail(500, "INTERNAL", "Could not delete the store. Please try again.");
  }
  return NextResponse.json({ success: true });
}
