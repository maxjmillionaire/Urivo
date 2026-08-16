import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Comped access — granting a real plan to a tester without charging them.
 *
 * Gated on the ADMIN_EMAILS allow-list and answering 404 rather than 403, so
 * the route is not discoverable by anyone who is not already an admin. The
 * database function does the rest of the safety work: it refuses to touch an
 * account with a live Stripe subscription, and every grant carries an expiry.
 */

const GrantSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  plan: z.enum(["core", "pro"]),
  days: z.number().int().min(1).max(365),
  credits: z.number().int().min(0).max(5000).default(0),
  reason: z.string().trim().max(200).default("tester"),
});

/** Why a grant was refused, in words an admin can act on. */
const REFUSALS: Record<string, string> = {
  NO_SUCH_USER:
    "No account with that address. They need to sign up first — access is granted to a real account, never created from here, so the email confirmation and signup checks still apply.",
  HAS_SUBSCRIPTION:
    "That account already pays. Comping it would overwrite the plan Stripe owns and the two would fight over the same column. Use the Stripe dashboard for a discount or refund instead.",
  INVALID_PLAN: "Plan must be Founder or Pro.",
  INVALID_DURATION: "Duration must be between 1 and 365 days.",
  INVALID_CREDITS: "Credits must be between 0 and 5000.",
};

async function requireAdmin(): Promise<string | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAdminEmail(user.email) ? (user.email ?? null) : null;
}

const notFound = () => NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

export async function GET() {
  if (!(await requireAdmin())) return notFound();

  const { data, error } = await supabaseAdmin().rpc("comped_accounts");
  if (error) {
    return NextResponse.json({ error: "READ_FAILED", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return notFound();

  let body: z.infer<typeof GrantSchema>;
  try {
    body = GrantSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc("grant_comped_access", {
    p_email: body.email,
    p_plan: body.plan,
    p_days: body.days,
    p_credits: body.credits,
    p_reason: body.reason,
  });
  if (error) {
    logger.error("Comp grant failed", { admin, message: error.message });
    return NextResponse.json({ error: "GRANT_FAILED", detail: error.message }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { granted: boolean; reason: string; expires_at: string | null }
    | undefined;

  if (!row?.granted) {
    const reason = row?.reason ?? "UNKNOWN";
    return NextResponse.json(
      { error: reason, detail: REFUSALS[reason] ?? "The grant was refused." },
      { status: 409 },
    );
  }

  // Worth a log line at warn: this is somebody being given paid access for free.
  logger.warn("Comped access granted", {
    admin,
    email: body.email,
    plan: body.plan,
    days: body.days,
    credits: body.credits,
    reason: body.reason,
  });

  return NextResponse.json({ ok: true, expiresAt: row.expires_at });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return notFound();

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const { data, error } = await supabaseAdmin().rpc("revoke_comped_access", { p_email: email });
  if (error) {
    return NextResponse.json({ error: "REVOKE_FAILED", detail: error.message }, { status: 500 });
  }
  if (data !== true) {
    return NextResponse.json(
      { error: "NOT_COMPED", detail: "That account has no granted access to revoke." },
      { status: 409 },
    );
  }

  logger.warn("Comped access revoked", { admin, email });
  return NextResponse.json({ ok: true });
}
