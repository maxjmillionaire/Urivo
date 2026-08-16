import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Signup guardrail (part 2.2). Called by the login screen BEFORE it hands off to
 * Supabase Auth. Two defenses:
 *   1. Per-IP throttle — caps account creation per network over a rolling
 *      window (durable across instances when Upstash is configured).
 *   2. Disposable-domain block — refuses known throwaway providers up front.
 *
 * This is defense-in-depth for UX and abuse-rate. The HARD economic backstop
 * lives in the database: welcome credits are withheld for blocked domains and
 * for unverified accounts regardless of whether this endpoint is reached
 * (migration 0019), so a scripted client that skips this check still can't turn
 * a signup into a free generation.
 */

const BodySchema = z.object({ email: z.string().email().max(200) });

export async function POST(request: NextRequest) {
  let email: string;
  try {
    email = BodySchema.parse(await request.json()).email.toLowerCase().trim();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "INVALID", message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";

  // Per-IP signup throttle: 5 attempts / 15 minutes.
  const limit = await rateLimit(`signup:${ip}`, 5, 15 * 60_000);
  if (!limit.success) {
    logger.warn("Signup throttled", { ip, email });
    return NextResponse.json(
      {
        ok: false,
        reason: "RATE_LIMITED",
        message: "Too many signups from this network. Please try again later.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Disposable / blocked email domains — refuse up front.
  try {
    const { data: blocked } = await supabaseAdmin().rpc("is_email_domain_blocked", { p_email: email });
    if (blocked === true) {
      logger.warn("Signup blocked: disposable domain", { ip, email });
      return NextResponse.json(
        { ok: false, reason: "DISPOSABLE", message: "Please sign up with a permanent email address." },
        { status: 422 },
      );
    }
  } catch {
    // Check unavailable → don't block signup here; the DB still withholds credits.
  }

  return NextResponse.json({ ok: true });
}
