import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/tenant";
import { getPlanForUser } from "@/lib/plan-access";
import { nextPlan } from "@/lib/plans";
import { StoreUpdateSchema } from "@/lib/validation";
import { notifyStorePublished, notifyPaymentsMissing } from "@/lib/notifications/events";
import { storeSellReadiness } from "@/lib/commerce/readiness";
import { revalidateStoreById } from "@/lib/storefront/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    .select("theme_config, is_active")
    .eq("id", id)
    .single();
  const wasLive = current?.is_active === true;

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
  if (body.isActive !== undefined) {
    if (body.isActive === true) {
      const plan = await getPlanForUser(owner.userId);
      if (!plan.features.publish) {
        return fail(
          403,
          "UPGRADE_REQUIRED",
          "Publishing your store is available on a paid plan. Upgrade to take it live.",
        );
      }

      /*
       * Capacity is enforced in the database, not here. Counting live stores in
       * application code and then writing is a race: two publishes arriving
       * together would both read the same count and both succeed. publish_store
       * locks the merchant's rows first, so the cap holds under any concurrency.
       */
      const { data: pub, error: pubErr } = await supabaseAdmin().rpc("publish_store", {
        p_store_id: id,
        p_max_live: plan.maxLiveStores,
      });
      const outcome = (Array.isArray(pub) ? pub[0] : pub) as
        | { published: boolean; live_count: number; reason: string }
        | null
        | undefined;

      if (pubErr || !outcome) {
        return fail(500, "INTERNAL", "Could not take your store live. Please try again.");
      }
      if (!outcome.published) {
        if (outcome.reason === "AT_CAPACITY") {
          const next = nextPlan(plan.key);
          return NextResponse.json(
            {
              error: "AT_CAPACITY",
              message:
                `You're running ${outcome.live_count} live store${outcome.live_count === 1 ? "" : "s"}, which is everything this plan carries. ` +
                (next
                  ? `${next.name} runs ${next.maxLiveStores === null ? "as many as you like" : `up to ${next.maxLiveStores}`}.`
                  : "Pause one to take another live."),
              liveCount: outcome.live_count,
              capacity: plan.maxLiveStores,
            },
            { status: 409 },
          );
        }
        return fail(404, "NOT_FOUND", "Store not found.");
      }
      // publish_store already flipped the flag atomically.
    } else {
      update.is_active = false;
    }
  }

  /*
   * `is_active` is not writable by a signed-in user any more (migration 0045):
   * publishing is a paid capability and a capacity decision, so the column
   * belongs to publish_store alone. Taking a store DOWN is always allowed and
   * has no cap to check, so it goes through the service role — with the owner
   * id repeated in the predicate, which keeps the row-level ownership check
   * that RLS was providing on this statement.
   */
  const unpublishing = update.is_active === false;
  const writer = unpublishing ? supabaseAdmin() : supabase;
  let q = writer.from("stores").update(update).eq("id", id);
  if (unpublishing) q = q.eq("user_id", owner.userId);
  const { data, error } = await q
    .select("id, store_name, subdomain, is_active, theme_config")
    .single();

  if (error) {
    return fail(500, "INTERNAL", "Could not save your changes. Please try again.");
  }

  /*
   * A store going live (draft → published) is a moment worth marking — and the
   * moment to check whether it can actually take money. Publishing is never
   * blocked: it is the emotional high point of the product. But a merchant must
   * not be congratulated on being "open for orders" while every shopper who
   * tries to buy is turned away.
   */
  if (body.isActive === true && !wasLive && data) {
    const { canSell } = await storeSellReadiness(supabaseAdmin(), data.id);
    await notifyStorePublished(owner.userId, data.id, data.store_name, canSell);
    if (!canSell) await notifyPaymentsMissing(owner.userId, data.id, data.store_name);
  }

  // The public storefront must not keep serving the previous version.
  await revalidateStoreById(id);

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
