import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Click-event retention (specifications/10-attribution.md §11). Run daily.
 *
 * A retention period that exists only in a document is not a retention period,
 * so this endpoint is the half that makes §11 real. It reports what it removed
 * AND what it declined to remove, because a cleanup job that returns nothing
 * is indistinguishable from a cleanup job that never ran.
 *
 * Same auth as the weekly digest: a shared secret, compared in constant time,
 * failing closed when unset.
 */

function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
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
      { error: "NOT_CONFIGURED", message: "Retention is not configured." },
      { status: 503 },
    );
  }
  if (!secretMatches(presentedSecret(request), expected)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin().rpc("expire_click_events", { p_days: 90 });
    /*
     * A failing cleanup must be loud. Silently returning ok would let retention
     * lapse indefinitely while the schedule reports success every night — the
     * exact shape of failure this whole subsystem exists to avoid.
     */
    if (error) throw new Error(`expire_click_events failed: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { deleted: number; retained_for_orders: number; cutoff: string }
      | undefined;

    return NextResponse.json(
      {
        ok: true,
        deleted: row?.deleted ?? 0,
        // Old, but still referenced by an order: kept deliberately as the audit
        // trail behind a financial record, and reported so it is never mistaken
        // for retention silently failing.
        retainedForOrders: row?.retained_for_orders ?? 0,
        cutoff: row?.cutoff ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    captureException(err, { route: "cron:expire-clicks" });
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
