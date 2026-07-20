import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditPack } from "@/lib/credit-packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Credit-pack purchase (Phase 2 boundary).
 *
 * A one-time payment that tops up the buyer's credit balance. Auth + validation
 * are complete here; the Stripe integration (a one-time Checkout Session for the
 * pack's price, then granting credits on checkout.session.completed via the
 * webhook) is Phase 2 and needs STRIPE_SECRET_KEY + the live domain. Until then
 * it degrades gracefully, mirroring /api/checkout.
 */

const BodySchema = z.object({ pack: z.enum(["boost", "studio", "scale"]) });

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Unknown credit pack." }, { status: 400 });
  }

  const pack = getCreditPack(body.pack);
  if (!pack) {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Unknown credit pack." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "BILLING_UNAVAILABLE",
        message: "Credit packs open at launch. Thanks for your interest!",
      },
      { status: 503 },
    );
  }

  // Phase 2: create a one-time Stripe Checkout Session for pack.priceEUR with
  // metadata { user_id, pack: pack.id, credits: pack.credits }, and grant the
  // credits from the webhook (grantCreditPack, idempotent per session).
  return NextResponse.json(
    { error: "NOT_IMPLEMENTED", message: "Credit-pack checkout is being finalised." },
    { status: 501 },
  );
}
