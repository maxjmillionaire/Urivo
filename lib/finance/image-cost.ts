import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IMAGE_COST_USD } from "./cost-model";

/*
 * The effective per-image cost, and — just as importantly — whether it is a
 * measurement or a guess.
 *
 * Provenance is carried alongside the number because this one input dominates
 * the cost of the free tier. A dashboard that prints €0.53 per free signup
 * without saying that two thirds of it is assumed invites decisions the data
 * does not support. Every figure downstream of an estimated rate is labelled.
 *
 * Cached in-process for a minute: it is read on the write path of every AI
 * action, and a settings round-trip per generation would be a real cost to pay
 * for a number that changes once.
 */

export type CostProvenance = "estimated" | "measured";

export interface ImageCost {
  /** USD per generated image, as currently in force. */
  rateUsd: number;
  source: CostProvenance;
  /** True when any figure derived from this should be shown as provisional. */
  isEstimate: boolean;
}

const TTL_MS = 60_000;
let cache: { value: ImageCost; at: number } | null = null;

export function fallbackImageCost(): ImageCost {
  return { rateUsd: IMAGE_COST_USD, source: "estimated", isEstimate: true };
}

export async function getImageCost(): Promise<ImageCost> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { data } = await supabaseAdmin()
      .from("platform_settings")
      .select("image_cost_usd, image_cost_source")
      .eq("id", true)
      .maybeSingle();

    const raw = data?.image_cost_usd;
    // Null means "no corrected rate has been entered" — fall back rather than
    // treating an absent setting as a rate of zero, which would make every
    // image look free.
    const rateUsd = raw === null || raw === undefined ? IMAGE_COST_USD : Number(raw);
    const source: CostProvenance = data?.image_cost_source === "measured" ? "measured" : "estimated";
    const value: ImageCost = {
      rateUsd: Number.isFinite(rateUsd) && rateUsd >= 0 ? rateUsd : IMAGE_COST_USD,
      source,
      isEstimate: source !== "measured",
    };
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Settings unreadable (or migration 0037 not applied): the code default is
    // the honest answer, and it is honestly labelled.
    return fallbackImageCost();
  }
}

/**
 * Set the real rate and bring the whole history with it.
 *
 * Rebasing is exact rather than approximate because the ledger stores the image
 * COUNT next to the cost — every historical row is recomputed as count × rate.
 * Without this the month's total would be a mixture of two different
 * assumptions, which is worse than either one alone.
 *
 * Returns how many ledger rows were corrected.
 */
export async function setImageCost(
  rateUsd: number,
  source: CostProvenance,
): Promise<{ rowsRebased: number }> {
  if (!Number.isFinite(rateUsd) || rateUsd < 0 || rateUsd > 10) {
    throw new Error(`Implausible per-image rate: ${rateUsd}`);
  }
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("platform_settings")
    .update({
      image_cost_usd: rateUsd,
      image_cost_source: source,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(`Could not save the image cost: ${error.message}`);

  cache = null;

  const { data, error: rebaseError } = await admin.rpc("rebase_image_costs", {
    p_rate_usd: rateUsd,
  });
  if (rebaseError) {
    // The rate is saved and applies from now on; history is simply still on the
    // old rate. Say so rather than pretending the whole operation failed.
    throw new Error(
      `Rate saved, but history could not be rebased: ${rebaseError.message}. ` +
        `Figures before now still use the previous rate.`,
    );
  }
  return { rowsRebased: Number(data ?? 0) };
}
