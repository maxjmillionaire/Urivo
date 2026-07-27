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
}

const DEFAULTS: PlatformSettings = {
  freeGenerationsEnabled: true,
  freeDailyGenerationCap: 0,
  dailyFreeSpendAlertUsd: 50,
  spendAlertLastSentOn: null,
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    const { data } = await supabaseAdmin()
      .from("platform_settings")
      .select(
        "free_generations_enabled, free_daily_generation_cap, daily_free_spend_alert_usd, spend_alert_last_sent_on",
      )
      .eq("id", true)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return {
      freeGenerationsEnabled: data.free_generations_enabled ?? true,
      freeDailyGenerationCap: data.free_daily_generation_cap ?? 0,
      dailyFreeSpendAlertUsd: Number(data.daily_free_spend_alert_usd ?? 50),
      spendAlertLastSentOn: data.spend_alert_last_sent_on ?? null,
    };
  } catch {
    return DEFAULTS; // fail open — never block on a settings read
  }
}

/** Flip the free-generation kill switch (admin only — caller must authorize). */
export async function setFreeGenerationsEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("platform_settings")
    .update({ free_generations_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(`Failed to update platform settings: ${error.message}`);
}

/** Record that today's spend alert has been sent (idempotency for the alert). */
export async function markSpendAlertSent(day: string): Promise<void> {
  await supabaseAdmin()
    .from("platform_settings")
    .update({ spend_alert_last_sent_on: day, updated_at: new Date().toISOString() })
    .eq("id", true);
}
