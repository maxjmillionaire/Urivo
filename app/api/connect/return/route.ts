import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { syncConnectAccount, connectState } from "@/lib/billing/connect";
import { notifyPayoutsReady } from "@/lib/notifications/events";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Where Stripe returns the merchant after onboarding. Stripe does not promise
 * the account is ready here — only that the merchant finished the form — so we
 * re-read the account rather than assume success. Doing it synchronously means
 * the dashboard reflects reality immediately instead of showing a stale
 * "not connected" state until the account.updated webhook lands.
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
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const requestId = newRequestId();
  let state: string = "pending";
  try {
    const status = await syncConnectAccount(user.id);
    state = connectState(status);
    if (status.chargesEnabled) {
      await notifyPayoutsReady(user.id);
    }
  } catch (err) {
    captureException(err, { requestId, userId: user.id, route: "connect-return" });
  }

  return NextResponse.redirect(`${origin}/dashboard/billing?payouts=${state}`);
}
