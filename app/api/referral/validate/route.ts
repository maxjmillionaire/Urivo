import { NextResponse, type NextRequest } from "next/server";
import { lookupCode } from "@/lib/referral/service";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Real-time creator-code validation for the signup field. Public (runs before
 * the user has an account) and read-only. Rate-limited per IP to blunt code
 * enumeration. Returns a coarse status only — never anything sensitive.
 *
 *   GET /api/referral/validate?code=MAX10
 *   → { status: "empty" | "invalid" | "inactive" | "valid", creatorName? }
 */
export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ status: "empty" });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const limit = await rateLimit(`refval:${ip}`, 40, 60_000);
  if (!limit.success) {
    // Don't leak lookup ability under load; behave as "can't tell right now".
    return NextResponse.json({ status: "empty" }, { status: 429 });
  }

  const result = await lookupCode(code);
  return NextResponse.json(
    { status: result.status, creatorName: result.creatorName ?? undefined },
    { headers: { "Cache-Control": "no-store" } },
  );
}
