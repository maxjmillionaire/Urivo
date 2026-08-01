import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Health / readiness check (spec 6.3 §32) — safe for uptime monitors and a
 * one-glance "is my deployment fully wired?" view after deploy. Reports which
 * dependencies are configured, without exposing secrets or making paid calls.
 */
const has = (v: string | undefined) => Boolean(v && v.length > 0);

export async function GET() {
  // Required for the product to function at all.
  const required = {
    supabaseUrl: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: has(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceKey: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anthropic: has(process.env.ANTHROPIC_API_KEY),
  };

  // Strongly recommended for a quality launch.
  const recommended = {
    productImages: has(process.env.HIGGSFIELD_API_KEY) || has(process.env.GOOGLE_AI_API_KEY),
    rateLimiter: has(process.env.UPSTASH_REDIS_REST_URL) ? "upstash" : "in-memory (per-instance)",
    email: has(process.env.RESEND_API_KEY),
    errorMonitoring: has(process.env.SENTRY_DSN),
    weeklyDigest: has(process.env.CRON_SECRET),
  };

  // Phase 2 — billing / commerce.
  const phase2 = {
    stripe: has(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: has(process.env.STRIPE_WEBHOOK_SECRET),
  };

  const launchReady = Object.values(required).every(Boolean);

  return NextResponse.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      launchReady,
      required,
      recommended,
      phase2,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
