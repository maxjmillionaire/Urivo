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
