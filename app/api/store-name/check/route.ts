import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { checkSubdomainAvailability } from "@/lib/naming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Live store-address availability. Authenticated + rate-limited so the founder
 * gets an instant, honest "available / taken" as they type — never a surprise
 * at submit time. Uses the service role so inactive stores count as taken.
 */
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  const limit = await rateLimit(`name-check:${user.id}`, 60, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = request.nextUrl.searchParams.get("subdomain") ?? "";
  if (raw.length > 63) {
    return NextResponse.json({ available: false, subdomain: raw.slice(0, 63), reason: "invalid" });
  }

  const result = await checkSubdomainAvailability(supabaseAdmin(), raw);
  return NextResponse.json(result);
}
