import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";
import { checkBrandDomains } from "@/lib/naming/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
 * Real-time domain availability for a single brand name. Powers the live check
 * as a founder types or renames — ".com available", ".com taken · .ai available"
 * — so they never commit to a brand they can't own. Authenticated + rate-limited.
 */
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });

  const limit = await rateLimit(`brand-domain:${user.id}`, 40, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Checking a bit fast — one moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const name = (request.nextUrl.searchParams.get("name") ?? "").slice(0, 60);
  const { label, results, best } = await checkBrandDomains(name);
  if (!label) return NextResponse.json({ label: "", results: [], best: null });

  return NextResponse.json({ label, results, best });
}
