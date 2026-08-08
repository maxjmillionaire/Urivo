import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Storefront traffic — the write + aggregate side of the visitor/conversion
 * pipeline (migration 0017). Cookieless and anonymised: we persist a random
 * per-session id, a coarse device class and the referrer host only — never an
 * IP, user-agent string or anything that identifies a person (DSGVO).
 *
 * Writes go through the service role (the public /api/track beacon has no user
 * session); the dashboard reads aggregates via the two RPCs.
 */

export type Device = "mobile" | "tablet" | "desktop" | "unknown";

const SESSION_MAX = 80;
const HOST_MAX = 120;
const PATH_MAX = 256;

/** Classify a device from a user-agent WITHOUT persisting the UA string. */
export function deviceFromUserAgent(ua: string | null | undefined): Device {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|windows phone/.test(s)) return "mobile";
  return "desktop";
}

/** Extract just the host from a referrer, dropping path/query (no PII). */
export function hostFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.slice(0, HOST_MAX) || null;
  } catch {
    return null;
  }
}

export interface RecordVisitInput {
  subdomain: string;
  sessionHash: string;
  path?: string | null;
  referrerHost?: string | null;
  device?: Device;
  /** The Urivo-generated ad that sent this visit (?uc=… on the link). */
  creativeId?: string | null;
  /** A merchant's own campaign tagging, kept separate from Urivo's own ads. */
  utmCampaign?: string | null;
  utmSource?: string | null;
  /** Automated client. Excluded from both sides of every ratio (spec 10 §13). */
  isBot?: boolean;
  /** Which signature matched, so a dropped visit can be explained. */
  botReason?: string | null;
}

/**
 * Record one storefront pageview. Resolves the store from its subdomain and
 * only counts ACTIVE (public) stores, so owner drafts don't inflate traffic.
 * Best-effort: analytics must never break the storefront.
 */
export async function recordVisit(input: RecordVisitInput): Promise<void> {
  const session = (input.sessionHash ?? "").trim().slice(0, SESSION_MAX);
  if (!session) return;
  try {
    const admin = supabaseAdmin();
    const { data: store } = await admin
      .from("stores")
      .select("id, is_active")
      .eq("subdomain", input.subdomain)
      .maybeSingle();
    if (!store || !store.is_active) return;

    /*
     * The attribution columns arrive with migration 0038. Naming them in an
     * insert on a database that has not applied it rejects the whole row and
     * the store silently stops recording traffic — so the write falls back to
     * the columns that have existed since 0001. Losing attribution is a
     * missing insight; losing the visit is a broken metric.
     */
    const base = {
      store_id: store.id,
      session_hash: session,
      path: input.path ? input.path.slice(0, PATH_MAX) : null,
      referrer_host: input.referrerHost ?? null,
      device: input.device ?? "unknown",
    };
    /*
     * Resolve the ad before naming it, rather than letting the foreign key
     * decide. Two reasons, and the second is the one that bit:
     *
     *   A tracked link copied from somewhere else must never take credit here
     *   (spec 10 §5) — ownership is checked, not assumed.
     *
     *   An unresolvable id would fail the whole insert, and the fallback below
     *   cannot tell "this column does not exist yet" from "this ad does not
     *   exist", so it discarded the UTM context too. A visit whose ad we
     *   cannot place is still a visit with a knowable source.
     */
    let creativeId: string | null = null;
    if (input.creativeId) {
      const { data: creative } = await admin
        .from("ad_creatives")
        .select("id")
        .eq("id", input.creativeId)
        .eq("store_id", store.id)
        .maybeSingle();
      creativeId = creative?.id ?? null;
    }

    const attributed = {
      ...base,
      creative_id: creativeId,
      utm_campaign: input.utmCampaign?.slice(0, 120) ?? null,
      utm_source: input.utmSource?.slice(0, 120) ?? null,
      // 0039. Bot visits are stored, not dropped: excluded from every metric,
      // but still answerable when a merchant asks where a visitor went.
      is_bot: input.isBot ?? false,
      bot_reason: input.botReason ?? null,
    };
    const { error } = await admin.from("store_visits").insert(attributed);
    if (!error) return;

    /*
     * Step back one migration at a time rather than all the way to `base`. A
     * database with 0038 but not 0039 keeps its attribution instead of losing
     * it alongside the bot flag — and a bot visit is skipped entirely there,
     * because recording it without the flag would count a crawler as a human.
     */
    const { creative_id, utm_campaign, utm_source } = attributed;
    if (input.isBot) return;
    const { error: legacy } = await admin
      .from("store_visits")
      .insert({ ...base, creative_id, utm_campaign, utm_source });
    if (legacy) await admin.from("store_visits").insert(base);
  } catch {
    /* analytics is never allowed to affect the storefront */
  }
}

export interface StoreStats {
  storeId: string;
  revenueTodayCents: number;
  revenueYesterdayCents: number;
  revenue7dCents: number;
  revenuePrev7dCents: number;
  revenueTotalCents: number;
  ordersToday: number;
  ordersYesterday: number;
  orders7d: number;
  ordersTotal: number;
  visitorsToday: number;
  visitorsYesterday: number;
  visitors7d: number;
  viewsToday: number;
}

const ZERO_STATS = (storeId: string): StoreStats => ({
  storeId,
  revenueTodayCents: 0,
  revenueYesterdayCents: 0,
  revenue7dCents: 0,
  revenuePrev7dCents: 0,
  revenueTotalCents: 0,
  ordersToday: 0,
  ordersYesterday: 0,
  orders7d: 0,
  ordersTotal: 0,
  visitorsToday: 0,
  visitorsYesterday: 0,
  visitors7d: 0,
  viewsToday: 0,
});

/**
 * Per-store sales + traffic for a set of stores, in one query. Returns a map
 * keyed by store id; stores with no data get a zero row so the caller can
 * always render every card.
 */
export async function storeStatsFor(storeIds: string[]): Promise<Map<string, StoreStats>> {
  const out = new Map<string, StoreStats>();
  for (const id of storeIds) out.set(id, ZERO_STATS(id));
  if (storeIds.length === 0) return out;

  const { data } = await supabaseAdmin().rpc("dashboard_store_stats", { p_store_ids: storeIds });
  for (const r of (data ?? []) as Record<string, string>[]) {
    out.set(r.store_id, {
      storeId: r.store_id,
      revenueTodayCents: Number(r.revenue_today_cents),
      revenueYesterdayCents: Number(r.revenue_yesterday_cents),
      revenue7dCents: Number(r.revenue_7d_cents),
      revenuePrev7dCents: Number(r.revenue_prev7d_cents),
      revenueTotalCents: Number(r.revenue_total_cents),
      ordersToday: Number(r.orders_today),
      ordersYesterday: Number(r.orders_yesterday),
      orders7d: Number(r.orders_7d),
      ordersTotal: Number(r.orders_total),
      visitorsToday: Number(r.visitors_today),
      visitorsYesterday: Number(r.visitors_yesterday),
      visitors7d: Number(r.visitors_7d),
      viewsToday: Number(r.views_today),
    });
  }
  return out;
}

/** Sum a set of per-store stats into one portfolio total. */
export function sumStats(stats: Iterable<StoreStats>): StoreStats {
  const t = ZERO_STATS("__total__");
  for (const s of stats) {
    t.revenueTodayCents += s.revenueTodayCents;
    t.revenueYesterdayCents += s.revenueYesterdayCents;
    t.revenue7dCents += s.revenue7dCents;
    t.revenuePrev7dCents += s.revenuePrev7dCents;
    t.revenueTotalCents += s.revenueTotalCents;
    t.ordersToday += s.ordersToday;
    t.ordersYesterday += s.ordersYesterday;
    t.orders7d += s.orders7d;
    t.ordersTotal += s.ordersTotal;
    t.visitorsToday += s.visitorsToday;
    t.visitorsYesterday += s.visitorsYesterday;
    t.visitors7d += s.visitors7d;
    t.viewsToday += s.viewsToday;
  }
  return t;
}
