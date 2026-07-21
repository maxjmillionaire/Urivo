import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeCode,
  isValidCodeFormat,
  codeDiscountRate,
  commissionFor,
  CREATOR_COMMISSION_RATE,
} from "./codes";

/*
 * Referral service — all creator/referral mutations in one server-only place.
 *
 * These are the exact functions Stripe plugs into in Phase 2 (marked ▶STRIPE):
 *   - checkout applies a code → applyReferralCode() (discount) + recordReferral()
 *     (attribution)
 *   - first successful payment → recordFirstPayment() (sets commission owed)
 *   - creator payout → markCommissionPaid()
 * Nothing here presumes Stripe exists; today they can be driven by the admin
 * API or tests. When Stripe lands, it calls the same functions — no structural
 * change.
 */

export interface Creator {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  code: string;
  commissionRate: number;
  status: "active" | "inactive";
  createdAt: string;
}

interface CreatorRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  code: string;
  commission_rate: number;
  status: "active" | "inactive";
  created_at: string;
}

function toCreator(r: CreatorRow): Creator {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    code: r.code,
    commissionRate: Number(r.commission_rate),
    status: r.status,
    createdAt: r.created_at,
  };
}

export class ReferralError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ReferralError";
  }
}

/** Create a creator with a unique code. Throws on bad/taken code. */
export async function createCreator(input: {
  name: string;
  code: string;
  email?: string | null;
  userId?: string | null;
  commissionRate?: number;
}): Promise<Creator> {
  const code = normalizeCode(input.code);
  if (!isValidCodeFormat(code)) {
    throw new ReferralError("INVALID_CODE", "Code must be 3–24 letters or numbers.");
  }
  const { data, error } = await supabaseAdmin()
    .from("creators")
    .insert({
      name: input.name.trim(),
      code,
      email: input.email?.trim() || null,
      user_id: input.userId ?? null,
      commission_rate: input.commissionRate ?? CREATOR_COMMISSION_RATE,
    })
    .select("*")
    .single();
  if (error) {
    if ((error.message || "").includes("duplicate") || error.code === "23505") {
      throw new ReferralError("CODE_TAKEN", "That code is already in use.");
    }
    throw new ReferralError("CREATE_FAILED", error.message);
  }
  return toCreator(data as CreatorRow);
}

/** Look up an active creator by code (case-insensitive). Null if none/inactive. */
export async function getCreatorByCode(rawCode: string): Promise<Creator | null> {
  const code = normalizeCode(rawCode);
  const { data } = await supabaseAdmin()
    .from("creators")
    .select("*")
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle();
  return data ? toCreator(data as CreatorRow) : null;
}

export interface CodeApplication {
  valid: boolean;
  creator?: Creator;
  discountRate: number;
  reason?: string;
}

/**
 * ▶STRIPE (checkout): validate a code and return the customer discount to apply
 * to the Stripe session. Discount is 0 during launch, 10% after — the code is
 * always valid for attribution even when the discount is 0.
 */
export async function applyReferralCode(
  rawCode: string,
  now: Date = new Date(),
): Promise<CodeApplication> {
  if (!isValidCodeFormat(rawCode)) {
    return { valid: false, discountRate: 0, reason: "INVALID_FORMAT" };
  }
  const creator = await getCreatorByCode(rawCode);
  if (!creator) return { valid: false, discountRate: 0, reason: "NOT_FOUND" };
  return { valid: true, creator, discountRate: codeDiscountRate(now) };
}

/**
 * ▶STRIPE (checkout): attribute a customer to a creator's code. First-touch —
 * a customer already attributed is never reassigned (idempotent). Records the
 * discount the customer received for the audit trail.
 */
export async function recordReferral(input: {
  customerId: string;
  code: string;
  now?: Date;
}): Promise<{ attributed: boolean; reason?: string }> {
  const creator = await getCreatorByCode(input.code);
  if (!creator) return { attributed: false, reason: "NOT_FOUND" };

  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from("referrals")
    .select("id")
    .eq("customer_id", input.customerId)
    .maybeSingle();
  if (existing) return { attributed: false, reason: "ALREADY_ATTRIBUTED" };

  const { error } = await admin.from("referrals").insert({
    creator_id: creator.id,
    code: creator.code,
    customer_id: input.customerId,
    discount_rate: codeDiscountRate(input.now ?? new Date()),
  });
  if (error) {
    // Unique race → someone attributed first; treat as already-attributed.
    if ((error.message || "").includes("duplicate") || error.code === "23505") {
      return { attributed: false, reason: "ALREADY_ATTRIBUTED" };
    }
    throw new ReferralError("ATTRIBUTION_FAILED", error.message);
  }
  return { attributed: true };
}

/**
 * ▶STRIPE (first successful payment): mark the referred customer's first payment
 * and compute the creator's commission (25% of that payment, once). Idempotent —
 * a second call for an already-paid referral is a no-op. Only affects a customer
 * who was actually referred.
 */
export async function recordFirstPayment(input: {
  customerId: string;
  /** Accounting amount (EUR-normalised). Commission is computed off this. */
  amountEur: number;
  /**
   * Optional localized checkout details (Stripe presentment, Phase 2). Stored
   * alongside the EUR accounting amount; does not affect the commission. Until
   * multi-currency checkout ships, callers omit this and everything is EUR.
   */
  presentment?: { currency: string; amount: number };
}): Promise<{ recorded: boolean; commissionEur?: number; reason?: string }> {
  const admin = supabaseAdmin();
  const { data: referral } = await admin
    .from("referrals")
    .select("id, creator_id, first_payment_status, creators(commission_rate)")
    .eq("customer_id", input.customerId)
    .maybeSingle();
  if (!referral) return { recorded: false, reason: "NOT_REFERRED" };
  if (referral.first_payment_status === "paid") {
    return { recorded: false, reason: "ALREADY_RECORDED" };
  }

  const rel = referral.creators as { commission_rate: number } | { commission_rate: number }[] | null;
  const creator = Array.isArray(rel) ? rel[0] : rel;
  const rate = creator ? Number(creator.commission_rate) : CREATOR_COMMISSION_RATE;
  const commissionEur = commissionFor(input.amountEur, rate);

  const { error } = await admin
    .from("referrals")
    .update({
      first_payment_status: "paid",
      first_payment_at: new Date().toISOString(),
      first_payment_amount_eur: input.amountEur,
      first_payment_currency: input.presentment?.currency.toUpperCase() ?? "EUR",
      first_payment_presentment_amount: input.presentment?.amount ?? input.amountEur,
      commission_status: "owed",
      commission_amount_eur: commissionEur,
    })
    .eq("id", referral.id)
    .neq("first_payment_status", "paid"); // guard against races
  if (error) throw new ReferralError("PAYMENT_RECORD_FAILED", error.message);

  return { recorded: true, commissionEur };
}

/** ▶STRIPE (payout): mark a creator's commission as paid out. */
export async function markCommissionPaid(
  referralId: string,
): Promise<{ paid: boolean; reason?: string }> {
  const admin = supabaseAdmin();
  const { data: referral } = await admin
    .from("referrals")
    .select("id, commission_status, commission_paid")
    .eq("id", referralId)
    .maybeSingle();
  if (!referral) return { paid: false, reason: "NOT_FOUND" };
  if (referral.commission_paid) return { paid: false, reason: "ALREADY_PAID" };
  if (referral.commission_status !== "owed") return { paid: false, reason: "NOT_OWED" };

  const { error } = await admin
    .from("referrals")
    .update({
      commission_status: "paid",
      commission_paid: true,
      commission_paid_at: new Date().toISOString(),
    })
    .eq("id", referralId);
  if (error) throw new ReferralError("PAYOUT_FAILED", error.message);
  return { paid: true };
}
