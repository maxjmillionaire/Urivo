import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { recordVisit, deviceFromUserAgent, hostFromReferrer } from "@/lib/analytics/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Storefront pageview beacon (public, unauthenticated). A tiny anonymised ping
 * from live storefronts powers the Visitors + Conversion metrics on the
 * Executive Command Center. Cookieless: the client sends a random per-session
 * id from sessionStorage — never a cookie, never PII. We derive only a coarse
 * device class and the referrer host here; no IP or user-agent is persisted.
 *
 * Rate-limited per session+store so a reload storm can't flood the log.
 */

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export async function POST(request: NextRequest) {
  let body: { subdomain?: unknown; sid?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const subdomain = typeof body.subdomain === "string" ? body.subdomain.toLowerCase().slice(0, 63) : "";
  const sid = typeof body.sid === "string" ? body.sid : "";
  const path = typeof body.path === "string" ? body.path : null;

  if (!SUBDOMAIN_PATTERN.test(subdomain) || sid.length < 6) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // One ping per session+store per 5s — deduping reloads without dropping real
  // navigation. Cheap guard; the RPC counts distinct sessions regardless.
  const limit = await rateLimit(`track:${subdomain}:${sid}`, 1, 5_000);
  if (!limit.success) return NextResponse.json({ ok: true });

  await recordVisit({
    subdomain,
    sessionHash: sid,
    path,
    referrerHost: hostFromReferrer(request.headers.get("referer")),
    device: deviceFromUserAgent(request.headers.get("user-agent")),
  });

  return NextResponse.json({ ok: true });
}
