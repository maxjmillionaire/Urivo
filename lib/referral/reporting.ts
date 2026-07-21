import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Referral reporting — feeds the admin affiliate dashboard from server-side
 * aggregation RPCs (migration 0012). Server-only; callers admin-gate first.
 */

export interface ReferralOverview {
  totalCreators: number;
  activeCreators: number;
  totalReferrals: number; // referred customers
  firstPayments: number;
  commissionsOwedEur: number;
  commissionsPaidEur: number;
  referralRevenueEur: number;
  conversionPct: number;
}

export interface TopCreator {
  creatorId: string;
  name: string;
  code: string;
  customers: number;
  firstPayments: number;
  commissionOwedEur: number;
  commissionPaidEur: number;
}

export interface ReferralSnapshot {
  overview: ReferralOverview;
  topCreators: TopCreator[];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export async function getReferralSnapshot(limit = 10): Promise<ReferralSnapshot> {
  const admin = supabaseAdmin();
  const [overviewRes, topRes] = await Promise.all([
    admin.rpc("referral_overview"),
    admin.rpc("referral_top_creators", { p_limit: limit }),
  ]);

  const o = (overviewRes.data ?? {}) as Record<string, unknown>;
  const overview: ReferralOverview = {
    totalCreators: num(o.total_creators),
    activeCreators: num(o.active_creators),
    totalReferrals: num(o.total_referrals),
    firstPayments: num(o.first_payments),
    commissionsOwedEur: num(o.commissions_owed_eur),
    commissionsPaidEur: num(o.commissions_paid_eur),
    referralRevenueEur: num(o.referral_revenue_eur),
    conversionPct: num(o.conversion_pct),
  };

  const topCreators: TopCreator[] = (
    (topRes.data ?? []) as {
      creator_id: string;
      name: string;
      code: string;
      customers: number;
      first_payments: number;
      commission_owed_eur: number;
      commission_paid_eur: number;
    }[]
  ).map((c) => ({
    creatorId: c.creator_id,
    name: c.name,
    code: c.code,
    customers: num(c.customers),
    firstPayments: num(c.first_payments),
    commissionOwedEur: num(c.commission_owed_eur),
    commissionPaidEur: num(c.commission_paid_eur),
  }));

  return { overview, topCreators };
}
