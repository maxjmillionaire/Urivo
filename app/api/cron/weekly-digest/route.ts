import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendWeeklyDigests } from "@/lib/platform/digest";
import { captureException } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Weekly business digest trigger. Meant to be called once a week by an external
 * scheduler (Railway cron, Supabase pg_cron net.http_post, GitHub Actions, a
 * cron-job.org ping) — not by a browser. Access is a shared secret in the
 * CRON_SECRET env var, matched in constant time.
 *
 * Fail closed: with CRON_SECRET unset the endpoint is disabled (503), so an
 * unconfigured deployment can never fan out mail. GET and POST both work — some
 * schedulers only issue GET.
 */

/** Constant-time compare that also resists length leakage. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedSecret(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return bearer || request.headers.get("x-cron-secret")?.trim() || "";
}

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "NOT_CONFIGURED", message: "Scheduled digests are not configured." },
      { status: 503 },
    );
  }
  if (!secretMatches(presentedSecret(request), expected)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const summary = await sendWeeklyDigests();
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    captureException(err, { route: "cron:weekly-digest" });
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
