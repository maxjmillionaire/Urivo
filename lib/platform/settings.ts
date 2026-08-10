import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Platform settings — the founder's operational control panel (migration 0020).
 * A single, server-authoritative row that can be changed WITHOUT a deploy:
 * the free-generation kill switch, the optional daily ceiling, and the spend
 * alert threshold. Read on the hot path (guarding free generations), so it
 * fails OPEN — a transient read error must never block paying customers, and
 * the kill switch is a deliberate action, not a fragile default.
 */

export interface PlatformSettings {
  freeGenerationsEnabled: boolean;
  freeDailyGenerationCap: number; // 0 = no cap
  dailyFreeSpendAlertUsd: number;
  spendAlertLastSentOn: string | null; // YYYY-MM-DD
  /** Ascending euro thresholds; each alerts once per day so a bad day escalates. */
  dailySpendThresholdsEur: number[];
  /** Highest threshold already alerted today — reset when the day rolls over. */
  spendAlertHighWaterEur: number;
  /** 0 = no budget set. Drives "remaining budget" on the finance dashboard. */
  monthlyAiBudgetEur: number;
}

const DEFAULT_THRESHOLDS = [25, 50, 100];

const DEFAULTS: PlatformSettings = {
  freeGenerationsEnabled: true,
  freeDailyGenerationCap: 0,
  dailyFreeSpendAlertUsd: 50,
  spendAlertLastSentOn: null,
  dailySpendThresholdsEur: DEFAULT_THRESHOLDS,
  spendAlertHighWaterEur: 0,
  monthlyAiBudgetEur: 0,
};

/** Ascending, positive, de-duplicated — the alert logic depends on the order. */
function normaliseThresholds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return DEFAULT_THRESHOLDS;
  const clean = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  return clean.length > 0 ? clean.sort((a, b) => a - b) : DEFAULT_THRESHOLDS;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    const { data } = await supabaseAdmin()
      .from("platform_settings")
      .select(
        "free_generations_enabled, free_daily_generation_cap, daily_free_spend_alert_usd, spend_alert_last_sent_on, daily_spend_thresholds_eur, spend_alert_high_water_eur, monthly_ai_budget_eur",
      )
      .eq("id", true)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return {
      freeGenerationsEnabled: data.free_generations_enabled ?? true,
      freeDailyGenerationCap: data.free_daily_generation_cap ?? 0,
      dailyFreeSpendAlertUsd: Number(data.daily_free_spend_alert_usd ?? 50),
      spendAlertLastSentOn: data.spend_alert_last_sent_on ?? null,
      dailySpendThresholdsEur: normaliseThresholds(data.daily_spend_thresholds_eur),
      spendAlertHighWaterEur: Number(data.spend_alert_high_water_eur ?? 0),
      monthlyAiBudgetEur: Number(data.monthly_ai_budget_eur ?? 0),
    };
  } catch {
    /*
     * Fail open. This is read on the hot path guarding free generations, so a
     * transient error must never block a paying customer — and the columns
     * above do not exist until migration 0037 is applied, which would otherwise
     * take the whole generation path down on a half-migrated deployment.
     */
    return DEFAULTS;
  }
}

/** Alert thresholds and the monthly budget — the founder's two spend dials. */
export async function setSpendControls(input: {
  thresholdsEur?: number[];
  monthlyBudgetEur?: number;
}): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.thresholdsEur !== undefined) {
    patch.daily_spend_thresholds_eur = normaliseThresholds(input.thresholdsEur);
    // A changed ladder means today's alerts should be reconsidered against it.
    patch.spend_alert_high_water_eur = 0;
  }
  if (input.monthlyBudgetEur !== undefined) {
    patch.monthly_ai_budget_eur = Math.max(0, input.monthlyBudgetEur);
  }
  const { error } = await supabaseAdmin().from("platform_settings").update(patch).eq("id", true);
  if (error) throw new Error(`Failed to update spend controls: ${error.message}`);
}

/**
 * Record that today's spend has alerted up to a given threshold.
 *
 * Stored as a high-water mark rather than a boolean, so €25 alerting does not
 * silence €100 later the same day. A day that runs away should get louder, not
 * quieter.
 */
export async function markSpendAlertSentAt(day: string, thresholdEur: number): Promise<void> {
  await supabaseAdmin()
    .from("platform_settings")
    .update({
      spend_alert_last_sent_on: day,
      spend_alert_high_water_eur: thresholdEur,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
}

/** Flip the free-generation kill switch (admin only — caller must authorize). */
export async function setFreeGenerationsEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("platform_settings")
    .update({ free_generations_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(`Failed to update platform settings: ${error.message}`);
}

// ------------------------------------------------------------------
// Founding members (first 50) — private tracking for the founder.
// ------------------------------------------------------------------

/**
 * Whether the Founding 50 offer is still open — the ONLY founding fact a public
 * page may read.
 *
 * Deliberately separate from getFoundingStatus(), which returns the members
 * themselves. The landing page is unauthenticated: pulling a list of customer
 * email addresses into its render, displayed or not, is the kind of mistake
 * that only looks harmless until something serialises it. This reads two
 * integers and nothing else.
 *
 * The landing page needs it because the advertised price must equal the price
 * the visitor will actually be charged. Once the cap is claimed a new signup is
 * stamped 'standard' and pays €49, so a page still showing €29 would be quoting
 * a price nobody can get.
 */
export interface FoundingOffer {
  /** True while a new signup would still claim a founding spot. */
  open: boolean;
  remaining: number;
}

export async function getFoundingOffer(): Promise<FoundingOffer> {
  /*
   * Fail CLOSED, for BOTH ways this can go wrong.
   *
   * If the counter cannot be read we do not know whether spots remain, and
   * advertising a price we cannot honour is worse than showing the standard
   * one — the standard price is always true.
   *
   * The try/catch matters as much as the error check: supabaseAdmin() THROWS
   * when the service-role key is absent, before any query runs. Without this,
   * a missing or rotated key takes down the whole marketing page with a 500
   * instead of quietly showing standard pricing. app/sitemap.ts already guards
   * its admin read the same way, for the same reason.
   */
  try {
    const { data, error } = await supabaseAdmin()
      .from("platform_settings")
      .select("founding_cap, founding_claimed")
      .eq("id", true)
      .maybeSingle();

    if (error || !data) return { open: false, remaining: 0 };

    const remaining = Math.max(0, (data.founding_cap ?? 0) - (data.founding_claimed ?? 0));
    return { open: remaining > 0, remaining };
  } catch {
    return { open: false, remaining: 0 };
  }
}

export interface FoundingMember {
  email: string;
  createdAt: string;
  plan: string;
  status: string;
}

export interface FoundingStatus {
  cap: number;
  claimed: number;
  remaining: number;
  subscribed: number;
  members: FoundingMember[];
}

export async function getFoundingStatus(): Promise<FoundingStatus> {
  const admin = supabaseAdmin();
  const [settingsRes, rowsRes] = await Promise.all([
    admin.from("platform_settings").select("founding_cap, founding_claimed").eq("id", true).maybeSingle(),
    admin
      .from("profiles")
      .select("email, created_at, plan, subscription_status")
      .eq("price_type", "founding")
      .order("created_at", { ascending: true }),
  ]);
  const cap = settingsRes.data?.founding_cap ?? 50;
  const claimed = settingsRes.data?.founding_claimed ?? 0;
  const members: FoundingMember[] = (rowsRes.data ?? []).map((r) => ({
    email: r.email,
    createdAt: r.created_at,
    plan: r.plan,
    status: r.subscription_status,
  }));
  const subscribed = members.filter((m) => m.status === "active").length;
  return { cap, claimed, remaining: Math.max(0, cap - claimed), subscribed, members };
}

/** Record that today's spend alert has been sent (idempotency for the alert). */
export async function markSpendAlertSent(day: string): Promise<void> {
  await supabaseAdmin()
    .from("platform_settings")
    .update({ spend_alert_last_sent_on: day, updated_at: new Date().toISOString() })
    .eq("id", true);
}
