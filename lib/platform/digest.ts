import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/service";
import { weeklyDigestEmail, type WeeklyDigestContent } from "@/lib/email/templates";
import { notifyOnce } from "@/lib/notifications/service";
import { STORE_GENERATION_COST } from "@/lib/credits";
import { logger } from "@/lib/logger";

/*
 * Weekly business digest — the habit-loop email. Once a week it aggregates each
 * active merchant's own signals (stores, products, credits, this week's orders)
 * in a single bounded query (the weekly_digest_data RPC) and sends a short,
 * contextual summary with one next-best-action. It also raises a deduped in-app
 * notification so the summary is waiting in the dashboard.
 *
 * Everything is platform-owned data — order/revenue figures read existing rows
 * and read zero cleanly before the first sale. Entirely best-effort: a failed
 * send for one merchant never affects another, and the job always reports a
 * summary rather than throwing.
 */

export interface DigestRow {
  user_id: string;
  email: string;
  full_name: string | null;
  credit_balance: number;
  credits_expiring_amount: number;
  credits_expiring_at: string | null;
  stores_total: number;
  stores_live: number;
  stores_new: number;
  products_total: number;
  orders_week: number;
  revenue_week_cents: number;
  orders_total: number;
  revenue_total_cents: number;
}

export interface DigestRunSummary {
  eligible: number;
  emailed: number;
  notified: number;
  failed: number;
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** "6 Aug" — compact, locale-stable date for the expiry line. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** How soon a credit expiry is worth nudging about (days). */
const EXPIRY_NUDGE_DAYS = 10;

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms <= EXPIRY_NUDGE_DAYS * 86_400_000;
}

/*
 * The heart of the digest: read the week and pick the single most useful thing
 * to say. Ordered by what most moves the merchant forward — a paused store
 * beats an idle nudge; a real sale beats everything.
 */
export function composeContent(r: DigestRow): WeeklyDigestContent {
  const name = r.full_name?.split(" ")[0] || undefined;
  const s = (n: number) => (n === 1 ? "" : "s");

  const stats: { label: string; value: string }[] = [
    { label: "Stores live", value: `${r.stores_live} of ${r.stores_total}` },
    { label: "Products", value: String(r.products_total) },
    { label: "Credits", value: String(r.credit_balance) },
  ];
  if (r.orders_week > 0) {
    stats.push({ label: "Orders this week", value: String(r.orders_week) });
    stats.push({ label: "Revenue this week", value: eur(r.revenue_week_cents) });
  }

  const expiringSoon = isExpiringSoon(r.credits_expiring_at);
  const footnote =
    expiringSoon && r.credits_expiring_at
      ? `${r.credits_expiring_amount} of your credits expire on ${shortDate(r.credits_expiring_at)} — plan credits are use-it-or-lose-it.`
      : undefined;

  // 1. A store that made sales this week — celebrate and compound it.
  if (r.orders_week > 0) {
    return {
      name,
      headline: `You made ${r.orders_week} sale${s(r.orders_week)} this week — ${eur(r.revenue_week_cents)}.`,
      nudge:
        "Momentum compounds. Sharpen your best store with Ask Urivo, or launch a second one to widen the funnel.",
      stats,
      ctaLabel: "Open your dashboard",
      ctaPath: "/dashboard",
      footnote,
    };
  }

  // 2. Stores exist but none are live — the single biggest blocker to revenue.
  if (r.stores_live === 0) {
    return {
      name,
      headline: `You have ${r.stores_total} store${s(r.stores_total)} ready, but ${r.stores_total === 1 ? "it isn't" : "none are"} live yet.`,
      nudge:
        "A store can't take orders until it's published. Take one live from your dashboard — it's a single click.",
      stats,
      ctaLabel: "Publish a store",
      ctaPath: "/dashboard",
      footnote,
    };
  }

  // 3. Credits expiring soon — use them before they're gone.
  if (expiringSoon && r.credits_expiring_at) {
    return {
      name,
      headline: `${r.credits_expiring_amount} of your credits expire on ${shortDate(r.credits_expiring_at)}.`,
      nudge:
        "Plan credits are use-it-or-lose-it. Put them to work — generate a new store or refine an existing one before they reset.",
      stats,
      ctaLabel: "Use your credits",
      ctaPath: "/dashboard",
    };
  }

  // 4. Low balance — can't generate another store.
  if (r.credit_balance < STORE_GENERATION_COST) {
    return {
      name,
      headline: "You're running low on credits.",
      nudge:
        "You don't have enough to generate another store. Top up anytime to keep building and refining.",
      stats,
      ctaLabel: "Top up credits",
      ctaPath: "/dashboard/billing",
      footnote,
    };
  }

  // 5. Live and healthy, but no sales this week — a gentle growth nudge.
  return {
    name,
    headline: "Your store is live and everything's running.",
    nudge:
      "No orders yet this week. A tighter product story or a small ad push can move the needle — try Ask Urivo to sharpen your copy, or the Ad Studio to launch a campaign.",
    stats,
    ctaLabel: "Open your dashboard",
    ctaPath: "/dashboard",
    footnote,
  };
}

/** Run in small concurrent batches so one weekly job doesn't hammer Resend. */
const BATCH_SIZE = 8;

/**
 * Aggregate and send the weekly digest to every active merchant. Returns a
 * summary; never throws. `weekKey` (defaults to today) makes the in-app
 * notification idempotent across accidental re-runs within the same week.
 */
export async function sendWeeklyDigests(weekKey?: string): Promise<DigestRunSummary> {
  const key = weekKey ?? new Date().toISOString().slice(0, 10);
  const summary: DigestRunSummary = { eligible: 0, emailed: 0, notified: 0, failed: 0 };

  const { data, error } = await supabaseAdmin().rpc("weekly_digest_data");
  if (error) {
    logger.error("weekly_digest_data failed", { error: error.message });
    return summary;
  }
  const rows = (data ?? []) as DigestRow[];
  summary.eligible = rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (r) => {
        try {
          const content = composeContent(r);

          // In-app: idempotent per merchant per week.
          await notifyOnce(
            r.user_id,
            `weekly:${key}`,
            {
              kind: "digest",
              title: "Your weekly summary",
              body: content.headline,
              href: content.ctaPath,
              severity: "info",
            },
            6,
          );
          summary.notified += 1;

          if (r.email) {
            const ok = await sendEmail({ to: r.email, email: weeklyDigestEmail(content) });
            if (ok) summary.emailed += 1;
          }
        } catch (err) {
          summary.failed += 1;
          logger.warn("weekly digest send failed", {
            userId: r.user_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  logger.info("weekly digest run complete", { ...summary, weekKey: key });
  return summary;
}
