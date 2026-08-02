import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/commerce/stripe";
import {
  ensureConnectAccount,
  createOnboardingLink,
  createExpressDashboardLink,
  getConnectStatus,
} from "@/lib/billing/connect";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Start (or resume) Stripe Connect onboarding — the flow that lets a merchant
 * actually get paid. One connected account per merchant: creating it is
 * idempotent, so a merchant who abandons half-way and returns picks up where
 * they left off instead of starting a second account.
 *
 * Once charges are enabled this opens the merchant's own Stripe Express
 * dashboard instead, so the same button keeps working after setup.
 */

function appOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error: "PAYOUTS_UNAVAILABLE",
        message:
          "Payout setup opens at launch. Reach us at urivosupport@gmail.com and we'll help right away.",
      },
      { status: 503 },
    );
  }

  const requestId = newRequestId();
  try {
    const status = await getConnectStatus(user.id);

    // Already selling — send them to their own Stripe dashboard instead.
    if (status.accountId && status.chargesEnabled) {
      return NextResponse.json({ url: await createExpressDashboardLink(status.accountId) });
    }

    const accountId = await ensureConnectAccount(user.id, user.email ?? null);
    return NextResponse.json({ url: await createOnboardingLink(accountId, appOrigin()) });
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "connect-onboard" });
    return NextResponse.json(
      { error: "ONBOARD_FAILED", message: "We couldn't open payout setup just now. Please try again." },
      { status: 502 },
    );
  }
}
