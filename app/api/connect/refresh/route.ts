import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/commerce/stripe";
import { ensureConnectAccount, createOnboardingLink } from "@/lib/billing/connect";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Stripe sends the merchant here when an onboarding link expired before they
 * finished (links are single-use and short-lived). Mint a fresh one and put them
 * straight back into the flow — a dead end here would strand a merchant who is
 * one step from being able to sell.
 */

function appOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function GET() {
  const origin = appOrigin();
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  if (!isStripeConfigured()) {
    return NextResponse.redirect(`${origin}/dashboard/billing?payouts=unavailable`);
  }

  const requestId = newRequestId();
  try {
    const accountId = await ensureConnectAccount(user.id, user.email ?? null);
    return NextResponse.redirect(await createOnboardingLink(accountId, origin));
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "connect-refresh" });
    return NextResponse.redirect(`${origin}/dashboard/billing?payouts=error`);
  }
}
