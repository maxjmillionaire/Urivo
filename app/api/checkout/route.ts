import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Checkout entry point (Phase 2 boundary).
 *
 * The UI and auth/validation are complete; the Stripe integration behind this
 * route (checkout session creation, price resolution, webhooks) is Phase 2 and
 * requires STRIPE_SECRET_KEY + the live domain for redirect URLs. Until those
 * exist, this returns a clean "billing not yet available" response so the
 * frontend degrades gracefully (spec 6.9 failure strategy).
 */

const BodySchema = z.object({ plan: z.enum(["core", "pro"]) });

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Please sign in." },
      { status: 401 },
    );
  }

  try {
    BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "Unknown plan." },
      { status: 400 },
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "BILLING_UNAVAILABLE",
        message: "Paid plans open at launch. Thanks for your interest!",
      },
      { status: 503 },
    );
  }

  // Phase 2: create a Stripe Checkout Session with the resolved price and
  // metadata (creator_id, campaign, price_type) and return its URL.
  return NextResponse.json(
    { error: "NOT_IMPLEMENTED", message: "Checkout is being finalised." },
    { status: 501 },
  );
}
