import "server-only";
import { getPlatformSettings, markSpendAlertSentAt } from "./settings";
import { adminEmails } from "@/lib/admin";
import { sendEmail } from "@/lib/email/service";
import { spendAlertEmail } from "@/lib/email/templates";
import { getTodaySnapshot, type TodaySnapshot } from "@/lib/finance/today";
import { getImageCost } from "@/lib/finance/image-cost";
import { logger } from "@/lib/logger";

/*
 * Daily spend alerting.
 *
 * Called after a generation, because that is where the money is. Two changes
 * from the first version, both learned from what the old one could not do:
 *
 * 1. A LADDER, NOT A LINE. One threshold that alerted once a day meant a day
 *    which crossed €25 at breakfast said nothing further when it reached €300
 *    by lunch — the alert went quiet exactly as the situation got worse. Each
 *    threshold now fires once, tracked as a high-water mark, so a runaway day
 *    escalates.
 *
 * 2. THE WHOLE PICTURE. The old mail carried two numbers and left the reading
 *    to whoever opened it. An alert you cannot act on without first opening a
 *    dashboard has interrupted you rather than informed you. This one states
 *    spend, revenue, margin, the dominant surface, and what to do.
 *
 * Entirely best-effort: it never throws into the generation path. A merchant's
 * store must not fail because an email did.
 */

const eur = (n: number) => `€${n.toFixed(2)}`;

/** The highest configured threshold today's spend has crossed, if any. */
function crossedThreshold(spendEur: number, thresholds: number[], alreadyAlertedAt: number): number | null {
  // Thresholds arrive ascending; take the largest crossed, so a spike that
  // clears three at once sends one email about the worst of them rather than
  // three about the same minute.
  const crossed = thresholds.filter((t) => spendEur >= t);
  if (crossed.length === 0) return null;
  const highest = crossed[crossed.length - 1];
  return highest > alreadyAlertedAt ? highest : null;
}

/**
 * What to do about it, decided from the numbers.
 *
 * The recommendation is the part worth getting right: at 3am the difference
 * between "watch it" and "pull the switch" is the entire value of the message.
 */
export function recommendation(t: TodaySnapshot): string {
  const freeShare = t.costEur > 0 ? t.freeCostEur / t.costEur : 0;

  if (freeShare >= 0.8 && t.freeCostEur >= 20) {
    return "Almost all of today's spend came from free accounts, which means it has no revenue behind it. If you did not expect a surge of signups, suspend free generations from Admin → Finance — it takes effect immediately and never touches paying customers.";
  }
  if (t.marginPct !== null && t.marginPct < 50) {
    return `Gross margin today is ${t.marginPct.toFixed(0)}%, well below the ~85% these plans are priced for. Check the cost-per-action table for the surface that moved before changing any price.`;
  }
  if (t.users > 0 && t.costEur / t.users > 3) {
    return `Spend per active account today is ${eur(t.costEur / t.users)}, which is high for a single day. Look at the top accounts on the finance dashboard — a single account can produce a day like this.`;
  }
  if (freeShare >= 0.5) {
    return "The free tier is the larger half of today's spend. That is normal while acquiring, and worth watching rather than acting on — the free-generation switch is there if it keeps climbing.";
  }
  return "Most of today's spend sits behind paying accounts, so this is cost of goods rather than a leak. No action needed unless it keeps climbing.";
}

const FEATURE_LABEL: Record<string, string> = {
  storeGeneration: "store generation",
  askMessage: "Ask Urivo",
  storeEdit: "the store editor",
  marketResearch: "market research",
  adStudio: "Ad Studio",
  productImage: "product images",
};

export async function maybeAlertSpend(): Promise<void> {
  try {
    const settings = await getPlatformSettings();
    const thresholds = settings.dailySpendThresholdsEur;
    if (thresholds.length === 0) return; // alerting disabled

    const today = new Date().toISOString().slice(0, 10);
    // A new day resets the ladder; otherwise carry the high-water mark forward.
    const alertedAt = settings.spendAlertLastSentOn === today ? settings.spendAlertHighWaterEur : 0;

    const snapshot = await getTodaySnapshot(today);
    if (!snapshot.available) return;

    const threshold = crossedThreshold(snapshot.costEur, thresholds, alertedAt);
    if (threshold === null) return;

    // Mark BEFORE sending, so a burst of concurrent generations cannot fan out
    // one email per generation for the same threshold.
    await markSpendAlertSentAt(today, threshold);

    const recipients = adminEmails();
    if (recipients.length === 0) {
      logger.warn("Spend past threshold but ADMIN_EMAILS is unset — nobody to tell", {
        threshold,
        costEur: snapshot.costEur,
      });
      return;
    }

    const image = await getImageCost();
    const top = snapshot.topFeature
      ? `${FEATURE_LABEL[snapshot.topFeature] ?? snapshot.topFeature} — ${eur(snapshot.topFeatureEur)} across ${snapshot.topFeatureActions} action${snapshot.topFeatureActions === 1 ? "" : "s"}`
      : null;

    const email = spendAlertEmail({
      thresholdEur: eur(threshold),
      totalEur: eur(snapshot.costEur),
      freeEur: eur(snapshot.freeCostEur),
      paidEur: eur(snapshot.paidCostEur),
      revenueEur: eur(snapshot.revenueEur),
      marginPct: snapshot.marginPct !== null ? `${snapshot.marginPct.toFixed(0)}%` : null,
      topOperation: top,
      recommendation: recommendation(snapshot),
      // Never let an estimate pass as a measurement in a message that asks for
      // a decision.
      estimateNote: image.isEstimate
        ? `Image cost is still the estimated $${image.rateUsd.toFixed(3)}/image, so figures involving generated photos are provisional.`
        : undefined,
    });

    await Promise.all(recipients.map((to) => sendEmail({ to, email })));
    logger.warn("Spend alert sent", {
      threshold,
      costEur: snapshot.costEur,
      freeEur: snapshot.freeCostEur,
      revenueEur: snapshot.revenueEur,
    });
  } catch (err) {
    logger.warn("maybeAlertSpend failed", { err: err instanceof Error ? err.message : String(err) });
  }
}
