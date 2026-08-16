import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { setFreeGenerationsEnabled, setSpendControls } from "@/lib/platform/settings";
import { setImageCost } from "@/lib/finance/image-cost";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Admin platform controls: the free-generation kill switch, the daily spend
 * alert ladder, the monthly AI budget, and the real per-image cost.
 *
 * Gated on the admin allow-list; 404 (not 403) so the route isn't discoverable.
 * Every field is optional and applied independently, so the console can save
 * one dial without resending the others.
 */

const BodySchema = z
  .object({
    freeGenerationsEnabled: z.boolean().optional(),
    /** Ascending euro thresholds for the daily spend alert. */
    spendThresholdsEur: z.array(z.number().positive().max(100_000)).max(6).optional(),
    monthlyAiBudgetEur: z.number().min(0).max(1_000_000).optional(),
    /**
     * The real Higgsfield rate. Saving it also rebases every historical ledger
     * row, so the month stops being a mixture of two different assumptions.
     */
    imageCostUsd: z.number().min(0).max(10).optional(),
    imageCostSource: z.enum(["estimated", "measured"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to change" });

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const result: Record<string, unknown> = { ok: true };

  try {
    if (body.freeGenerationsEnabled !== undefined) {
      await setFreeGenerationsEnabled(body.freeGenerationsEnabled);
      logger.warn("Admin toggled free generations", {
        admin: user.email,
        freeGenerationsEnabled: body.freeGenerationsEnabled,
      });
      result.freeGenerationsEnabled = body.freeGenerationsEnabled;
    }

    if (body.spendThresholdsEur !== undefined || body.monthlyAiBudgetEur !== undefined) {
      await setSpendControls({
        thresholdsEur: body.spendThresholdsEur,
        monthlyBudgetEur: body.monthlyAiBudgetEur,
      });
      logger.info("Admin updated spend controls", {
        admin: user.email,
        thresholds: body.spendThresholdsEur,
        budget: body.monthlyAiBudgetEur,
      });
    }

    if (body.imageCostUsd !== undefined) {
      const { rowsRebased } = await setImageCost(
        body.imageCostUsd,
        body.imageCostSource ?? "measured",
      );
      logger.warn("Admin set the per-image cost", {
        admin: user.email,
        imageCostUsd: body.imageCostUsd,
        source: body.imageCostSource ?? "measured",
        rowsRebased,
      });
      result.rowsRebased = rowsRebased;
    }

    return NextResponse.json(result);
  } catch (err) {
    /*
     * The image-cost path can partially succeed — the rate saves and applies
     * going forward while the historical rebase fails. Its error says so in
     * words, so pass it through rather than flattening it to "update failed".
     */
    const detail = err instanceof Error ? err.message : "Update failed.";
    return NextResponse.json({ error: "UPDATE_FAILED", detail }, { status: 500 });
  }
}
