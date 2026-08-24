import { NextResponse, type NextRequest } from "next/server";
import { requireStoreOwner } from "@/lib/tenant";
import { getPlanForUser } from "@/lib/plan-access";
import { supabaseServer } from "@/lib/supabase/server";
import { validateCampaign, sendCampaign } from "@/lib/marketing/campaign";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sending is one request per recipient (bounded concurrency); give the list room.
export const maxDuration = 300;

/*
 * Send a campaign to a store's subscribers.
 *
 * This is the one genuinely outward-facing action here — it puts mail in real
 * inboxes — so it is deliberately explicit: the merchant composes and presses
 * Send, ownership is verified, and it is refused unless email is actually
 * configured (rather than silently recording a "sent" campaign that reached no
 * one). Every message carries a working unsubscribe (built in sendCampaign).
 */

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStoreOwner(id);
  if (!auth.ok) {
    return auth.reason === "UNAUTHORIZED"
      ? fail(401, "UNAUTHORIZED", "Please sign in.")
      : fail(404, "NOT_FOUND", "Store not found.");
  }

  const plan = await getPlanForUser(auth.userId);
  if (!plan.features.publish) {
    return fail(403, "UPGRADE_REQUIRED", "Email campaigns are available on Founder and Pro. Upgrade to reach your subscribers.");
  }

  // Honest failure: don't record a campaign as "sent" when nothing can send.
  if (!process.env.RESEND_API_KEY) {
    return fail(503, "EMAIL_UNAVAILABLE", "Email sending isn't switched on yet. Your campaign was not sent.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "INVALID_INPUT", "Invalid request.");
  }
  const parsed = validateCampaign((raw ?? {}) as { subject?: unknown; body?: unknown });
  if (!parsed.ok) return fail(400, "INVALID_INPUT", parsed.error);

  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("store_name, subdomain")
    .eq("id", id)
    .single();
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  // Public origin for the unsubscribe links — must be reachable by a recipient,
  // so prefer the configured app URL over the (possibly internal) request host.
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/+$/, "");

  const requestId = newRequestId();
  try {
    const result = await sendCampaign({
      storeId: id,
      storeName: store.store_name as string,
      subject: parsed.value.subject,
      body: parsed.value.body,
      origin,
    });
    if (result.audienceCount === 0) {
      return fail(422, "NO_SUBSCRIBERS", "You don't have any subscribers to send to yet.");
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    captureException(err, { requestId, userId: auth.userId, route: "campaigns:send" });
    return fail(500, "SEND_FAILED", "We couldn't finish sending that campaign. Please try again.");
  }
}
