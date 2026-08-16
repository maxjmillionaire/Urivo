import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { payOutCreator, NothingOwedError } from "@/lib/referral/payouts";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Admin-only: record a payout to a creator, settling everything currently owed.
 *
 * The amount is deliberately NOT accepted from the client — it is computed in
 * the database from the locked set of owed commissions, so a stale page or a
 * double click can never over-pay. The body only records how the transfer was
 * actually made.
 */

const BodySchema = z.object({
  creatorId: z.string().uuid(),
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(400).optional(),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Don't reveal the route to non-admins.
  if (!user || !isAdminEmail(user.email)) return fail(404, "NOT_FOUND", "Not found.");

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const requestId = newRequestId();
  try {
    const result = await payOutCreator(body.creatorId, {
      method: body.method,
      reference: body.reference,
      note: body.note,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof NothingOwedError) {
      return fail(409, "NOTHING_OWED", "There's nothing owed to this creator right now.");
    }
    captureException(err, { requestId, route: "admin-payouts", creatorId: body.creatorId });
    return fail(500, "PAYOUT_FAILED", "Could not record the payout. Please try again.");
  }
}
