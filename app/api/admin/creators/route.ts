import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { createCreator, ReferralError } from "@/lib/referral/service";
import { CREATOR_COMMISSION_RATE } from "@/lib/referral/codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Admin-only: create a creator + referral code. Admin-gated (ADMIN_EMAILS).
 * This is how creators enter the system today; the same records power the
 * referral dashboard and, in Phase 2, Stripe attribution.
 */

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(3).max(24),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  commissionRate: z.number().min(0).max(1).optional(),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

async function requireAdmin() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAdminEmail(user.email) ? user : null;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return fail(404, "NOT_FOUND", "Not found."); // don't reveal the route

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  try {
    const creator = await createCreator({
      name: body.name,
      code: body.code,
      email: body.email || null,
      commissionRate: body.commissionRate ?? CREATOR_COMMISSION_RATE,
    });
    return NextResponse.json({ success: true, creator });
  } catch (err) {
    if (err instanceof ReferralError) {
      const status = err.code === "CODE_TAKEN" ? 409 : err.code === "INVALID_CODE" ? 400 : 500;
      return fail(status, err.code, err.message);
    }
    return fail(500, "INTERNAL", "Could not create the creator.");
  }
}
