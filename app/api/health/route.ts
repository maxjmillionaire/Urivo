import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Lightweight health check (spec 6.3 §32) — safe for uptime monitors.
 * Reports app liveness and whether core dependencies are configured,
 * without exposing secrets or performing expensive calls.
 */
export async function GET() {
  const checks = {
    app: "ok",
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    rateLimiter: process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "in-memory",
  };

  return NextResponse.json(
    { status: "ok", time: new Date().toISOString(), checks },
    { headers: { "Cache-Control": "no-store" } },
  );
}
