import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireStoreOwner } from "@/lib/tenant";
import { parseLogo, LOGO_POSITIONS } from "@/lib/storefront/design-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Brand logo for a store's product shots. The logo file lives in the public
 * product-images bucket (logos/ prefix); its URL + placement/size/opacity live
 * in stores.theme_config.logo. Overlay is applied non-destructively at render
 * time, so placement changes are instant and the original photos stay clean.
 */

const BUCKET = "product-images";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

async function currentTheme(id: string): Promise<Record<string, unknown>> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("stores").select("theme_config").eq("id", id).single();
  return (data?.theme_config ?? {}) as Record<string, unknown>;
}

async function saveTheme(id: string, theme: Record<string, unknown>) {
  return supabaseAdmin().from("stores").update({ theme_config: theme }).eq("id", id);
}

// Upload a new logo file.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("logo");
    if (f instanceof File) file = f;
  } catch {
    return fail(400, "INVALID_INPUT", "Could not read the upload.");
  }
  if (!file) return fail(400, "INVALID_INPUT", "No logo file was provided.");
  const ext = ALLOWED.get(file.type);
  if (!ext) return fail(415, "UNSUPPORTED", "Use a PNG, SVG, JPG or WebP logo.");
  if (file.size > MAX_BYTES) return fail(413, "TOO_LARGE", "Logo must be under 2MB.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `logos/${id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return fail(500, "INTERNAL", "Could not store the logo. Please try again.");
  const url = supabaseAdmin().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const theme = await currentTheme(id);
  const prev = (theme.logo ?? {}) as Record<string, unknown>;
  theme.logo = {
    url,
    position: prev.position ?? "bottom-right",
    sizePct: prev.sizePct ?? 18,
    opacity: prev.opacity ?? 1,
  };
  const { error } = await saveTheme(id, theme);
  if (error) return fail(500, "INTERNAL", "Could not save the logo. Please try again.");

  return NextResponse.json({ success: true, logo: parseLogo(theme) });
}

const ConfigSchema = z.object({
  position: z.enum(LOGO_POSITIONS).optional(),
  sizePct: z.number().min(6).max(40).optional(),
  opacity: z.number().min(0.2).max(1).optional(),
});

// Update placement / size / opacity.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  let body: z.infer<typeof ConfigSchema>;
  try {
    body = ConfigSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const theme = await currentTheme(id);
  const logo = theme.logo as Record<string, unknown> | undefined;
  if (!logo?.url) return fail(400, "NO_LOGO", "Upload a logo first.");
  theme.logo = { ...logo, ...body };
  const { error } = await saveTheme(id, theme);
  if (error) return fail(500, "INTERNAL", "Could not save your changes. Please try again.");

  return NextResponse.json({ success: true, logo: parseLogo(theme) });
}

// Remove the logo.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const theme = await currentTheme(id);
  delete theme.logo;
  const { error } = await saveTheme(id, theme);
  if (error) return fail(500, "INTERNAL", "Could not remove the logo. Please try again.");
  return NextResponse.json({ success: true });
}
