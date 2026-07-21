import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireStoreOwner } from "@/lib/tenant";
import { getPlanForUser } from "@/lib/plan-access";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { parseTheme } from "@/lib/storefront";
import {
  parseDesignSystem,
  themeToDesignSystem,
  FONT_KEYS,
  NAV_VARIANTS,
  HERO_VARIANTS,
  CARD_VARIANTS,
  FOOTER_VARIANTS,
  BUTTON_SHAPES,
  SHADOW_LEVELS,
  IMAGE_TREATMENTS,
  MOTION_LEVELS,
  DENSITIES,
  SECTION_KEYS,
} from "@/lib/storefront/design-system";
import {
  applyDesignPatch,
  resolveProductEdits,
  type DesignPatch,
  type ProductEdit,
} from "@/lib/storefront/apply-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Apply a confirmed "Ask Urivo" edit. The plan is re-validated here — never
 * trusted from the client — and design changes are re-clamped through the design
 * system before persisting. Product edits reference the current catalogue by
 * index; stale indices are ignored.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const en = <T extends readonly string[]>(v: T) => z.enum(v as unknown as [string, ...string[]]);

const DesignSchema = z
  .object({
    name: z.string().min(2).max(60).optional(),
    tagline: z.string().min(2).max(160).optional(),
    personality: z.string().min(3).max(80).optional(),
    background: hex.optional(),
    ink: hex.optional(),
    accent: hex.optional(),
    headingKey: en(FONT_KEYS).optional(),
    bodyKey: en(FONT_KEYS).optional(),
    radius: z.number().min(0).max(32).optional(),
    buttonShape: en(BUTTON_SHAPES).optional(),
    shadow: en(SHADOW_LEVELS).optional(),
    density: en(DENSITIES).optional(),
    nav: en(NAV_VARIANTS).optional(),
    hero: en(HERO_VARIANTS).optional(),
    card: en(CARD_VARIANTS).optional(),
    footer: en(FOOTER_VARIANTS).optional(),
    imageTreatment: en(IMAGE_TREATMENTS).optional(),
    motion: en(MOTION_LEVELS).optional(),
    announcement: z.string().max(120).nullable().optional(),
    sectionOrder: en(SECTION_KEYS).array().optional(),
  })
  .optional();

const ProductSchema = z.object({
  action: z.enum(["add", "update", "remove"]),
  index: z.number().int().min(0).optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(400).optional(),
  priceEUR: z.number().positive().max(100000).optional(),
});

const PlanSchema = z.object({
  summary: z.string().max(200).optional(),
  design: DesignSchema,
  products: ProductSchema.array().max(8).optional(),
  setLive: z.boolean().optional(),
});

const BodySchema = z.object({ plan: PlanSchema });

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Convert validated flat product edits into the strict union, dropping any that
 *  are semantically incomplete. */
function toProductEdits(raw: z.infer<typeof ProductSchema>[]): ProductEdit[] {
  const out: ProductEdit[] = [];
  for (const e of raw) {
    if (e.action === "add") {
      if (e.title && e.description && typeof e.priceEUR === "number") {
        out.push({ action: "add", title: e.title, description: e.description, priceEUR: e.priceEUR });
      }
    } else if (e.action === "update") {
      if (typeof e.index === "number" && (e.title || e.description || typeof e.priceEUR === "number")) {
        out.push({ action: "update", index: e.index, title: e.title, description: e.description, priceEUR: e.priceEUR });
      }
    } else if (e.action === "remove") {
      if (typeof e.index === "number") out.push({ action: "remove", index: e.index });
    }
  }
  return out;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  // The AI Store Assistant is a paid capability (Founder and Pro).
  const userPlan = await getPlanForUser(owner.userId);
  if (!userPlan.features.askUrivo) {
    return fail(
      403,
      "UPGRADE_REQUIRED",
      "The AI Store Assistant is available on Founder and Pro. Upgrade to edit with Urivo.",
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }
  const plan = body.plan;

  const requestId = newRequestId();
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const { data: store } = await supabase.from("stores").select("store_name, theme_config").eq("id", id).single();
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  const config = (store.theme_config ?? {}) as Record<string, unknown>;
  const currentDs = config.designSystem
    ? parseDesignSystem(config.designSystem)
    : themeToDesignSystem(parseTheme(store.theme_config));

  try {
    // --- Design ---
    const storeUpdate: Record<string, unknown> = {};
    if (plan.design && Object.keys(plan.design).length > 0) {
      const newDs = applyDesignPatch(currentDs, plan.design as DesignPatch);
      storeUpdate.theme_config = {
        ...config,
        designSystem: newDs,
        tagline: newDs.tagline ?? (config.tagline as string) ?? "",
        palette: {
          primaryBackground: newDs.palette.background,
          secondaryStructure: newDs.palette.ink,
          accentConversion: newDs.palette.accent,
        },
      };
      if (plan.design.name) storeUpdate.store_name = plan.design.name;
    }
    if (typeof plan.setLive === "boolean") {
      // Going live is a paid capability; unpublishing is always allowed.
      if (plan.setLive === true && !userPlan.features.publish) {
        return fail(
          403,
          "UPGRADE_REQUIRED",
          "Publishing your store is available on Founder and Pro. Upgrade to take it live.",
        );
      }
      storeUpdate.is_active = plan.setLive;
    }
    if (Object.keys(storeUpdate).length > 0) {
      const { error } = await admin.from("stores").update(storeUpdate).eq("id", id);
      if (error) throw error;
    }

    // --- Products ---
    if (plan.products && plan.products.length > 0) {
      const { data: rows } = await admin
        .from("products")
        .select("id, title, description, price_eur, position")
        .eq("store_id", id)
        .order("position", { ascending: true });
      const current = (rows ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description ?? "",
        price_eur: Number(r.price_eur),
        position: r.position,
      }));
      const mut = resolveProductEdits(current, toProductEdits(plan.products));

      if (mut.deletes.length) {
        const { error } = await admin.from("products").delete().in("id", mut.deletes);
        if (error) throw error;
      }
      for (const u of mut.updates) {
        const patch: Record<string, unknown> = {};
        if (u.title !== undefined) patch.title = u.title;
        if (u.description !== undefined) patch.description = u.description;
        if (u.price_eur !== undefined) patch.price_eur = u.price_eur;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("products").update(patch).eq("id", u.id);
          if (error) throw error;
        }
      }
      if (mut.inserts.length) {
        const { error } = await admin
          .from("products")
          .insert(mut.inserts.map((i) => ({ ...i, store_id: id, inventory_count: 100 })));
        if (error) throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    captureException(err, { requestId, userId: owner.userId, route: "store-edit-apply" });
    return fail(500, "INTERNAL", "Could not apply the change. Please try again.");
  }
}
