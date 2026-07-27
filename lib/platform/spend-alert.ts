import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlatformSettings, markSpendAlertSent } from "./settings";
import { adminEmails } from "@/lib/admin";
import { sendEmail } from "@/lib/email/service";
import { spendAlertEmail } from "@/lib/email/templates";
import { logger } from "@/lib/logger";

/*
 * Spend alerting (part 2.5). Called after the heavy action (a generation) so it
 * runs where the money is. It sums today's real inference cost split by account
 * type — free vs paid — and, when FREE spend crosses the configurable threshold,
 * emails the admins once per day. Free spend is the number with no revenue
 * behind it; paid spend is expected cost of goods, reported only for contrast.
 *
 * Entirely best-effort: it never throws into the generation path.
 */

const usd = (n: number) => `$${n.toFixed(2)}`;

export async function maybeAlertSpend(): Promise<void> {
  try {
    const settings = await getPlatformSettings();
    if (settings.dailyFreeSpendAlertUsd <= 0) return; // alerting disabled

    const today = new Date().toISOString().slice(0, 10);
    if (settings.spendAlertLastSentOn === today) return; // already alerted today

    const { data } = await supabaseAdmin().rpc("platform_daily_spend", { p_day: today });
    const row = (Array.isArray(data) ? data[0] : data) as
      | { free_usd: number | string; paid_usd: number | string }
      | null
      | undefined;
    const freeUsd = Number(row?.free_usd ?? 0);
    const paidUsd = Number(row?.paid_usd ?? 0);
    if (freeUsd < settings.dailyFreeSpendAlertUsd) return;

    // Mark first so a burst of concurrent generations can't fan out N emails.
    await markSpendAlertSent(today);

    const recipients = adminEmails();
    if (recipients.length === 0) {
      logger.warn("Free-tier spend over threshold but no ADMIN_EMAILS set", { freeUsd, paidUsd });
      return;
    }

    const email = spendAlertEmail(usd(freeUsd), usd(paidUsd), usd(settings.dailyFreeSpendAlertUsd));
    await Promise.all(recipients.map((to) => sendEmail({ to, email })));
    logger.warn("Free-tier spend alert sent", {
      freeUsd,
      paidUsd,
      threshold: settings.dailyFreeSpendAlertUsd,
    });
  } catch (err) {
    logger.warn("maybeAlertSpend failed", { err: err instanceof Error ? err.message : String(err) });
  }
}
