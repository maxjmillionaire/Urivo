import { NextResponse, type NextRequest } from "next/server";
import { runPreflight } from "@/lib/launch/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Health / readiness.
 *
 * Two modes, because the two audiences want opposite things.
 *
 * The PUBLIC response is what an uptime monitor should poll: does this process
 * answer, and is it wired well enough to function. It states no secrets, makes
 * no outbound calls and touches no database, so it stays free to hit every
 * thirty seconds forever.
 *
 * The DEEP response is what a person wants in the ten minutes after a deploy,
 * and it is a different question entirely — it probes the database, compares
 * the deployed schema against the functions the code calls, and asks Stripe
 * whether the key is real and which mode it is in. That costs a database read
 * and two network calls, and it reports exactly the things an attacker would
 * like to know, so it is behind CRON_SECRET:
 *
 *     GET /api/health?deep=1&key=$CRON_SECRET
 *
 * Fails closed: with CRON_SECRET unset there is no deep mode at all.
 */

const has = (v: string | undefined) => Boolean(v && v.length > 0);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: NextRequest) {
  const wantsDeep = request.nextUrl.searchParams.get("deep") === "1";

  if (wantsDeep) {
    const secret = process.env.CRON_SECRET;
    const provided =
      request.nextUrl.searchParams.get("key") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    // 404, not 401: an endpoint that answers differently when the secret is
    // wrong tells an anonymous caller that a deep mode exists.
    if (!has(secret) || !timingSafeEqual(secret!, provided)) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const report = await runPreflight();
    return NextResponse.json(report, {
      status: report.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

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
    customDomains: has(process.env.CLOUDFLARE_API_TOKEN) && has(process.env.CLOUDFLARE_ZONE_ID),
  };

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
      /*
       * Named so nobody mistakes a green light here for a verified deployment.
       * Everything above is "a value is present"; none of it has been tried.
       */
      note: "Presence only — nothing here has been tested. Run ?deep=1&key=$CRON_SECRET to actually probe the database, schema and Stripe.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
