import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Storefront email capture (public — shoppers are anonymous).
 *
 * The write goes through subscribe_to_store, a definer RPC that only accepts an
 * address for a LIVE store and is idempotent on (store, email). The table has
 * no INSERT policy at all, so this route is the single door: a scraper cannot
 * enumerate or pollute a merchant's list by talking to PostgREST directly.
 *
 * Always answers the same way. Whether the address is new, already on the list,
 * or belongs to a store that does not exist, the shopper sees one calm
 * confirmation — anything else turns a newsletter box into an oracle for
 * checking which addresses a merchant already has.
 */

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

const BodySchema = z.object({
  // Deliberately permissive: real-world addresses defeat clever regexes, and
  // the RPC re-validates. Length is what actually needs bounding.
  email: z.string().trim().min(3).max(254).email(),
  source: z.string().trim().max(40).optional(),
});

/** The shopper's view never varies — see the note above. */
const OK = NextResponse.json({ ok: true });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subdomain: string }> },
) {
  const { subdomain } = await params;
  if (!SUBDOMAIN_RE.test(subdomain)) return OK;

  // Per-IP, per-store: enough for a real shopper, useless for a list bomber.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = await rateLimit(`subscribe:${subdomain}:${ip}`, 5, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { ok: false, message: "That's a few too many tries. Give it a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, message: "That doesn't look like an email address." },
      { status: 400 },
    );
  }

  const requestId = newRequestId();
  try {
    /*
     * `error` must be read, not just `catch`ed. supabase-js resolves rather
     * than throws on a failed call, so ignoring it would tell a shopper
     * "you're on the list" while nothing was written — the exact silent data
     * loss this form was rewritten to end.
     */
    const { error } = await supabaseAdmin().rpc("subscribe_to_store", {
      p_subdomain: subdomain,
      p_email: body.email,
      p_source: body.source ?? "storefront",
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    captureException(err, { requestId, route: "store:subscribe", subdomain });
    return NextResponse.json(
      { ok: false, message: "We couldn't save that just now. Please try again." },
      { status: 503 },
    );
  }

  return OK;
}
