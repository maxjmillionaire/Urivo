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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: {
    subdomain?: unknown;
    sid?: unknown;
    path?: unknown;
    uc?: unknown;
    campaign?: unknown;
    source?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const subdomain = typeof body.subdomain === "string" ? body.subdomain.toLowerCase().slice(0, 63) : "";
  const sid = typeof body.sid === "string" ? body.sid : "";
  const path = typeof body.path === "string" ? body.path : null;
  // ?uc= on the storefront link — the ad that sent this visitor. Validated as
  // a uuid rather than trusted: it becomes a foreign key.
  const uc = typeof body.uc === "string" && UUID.test(body.uc) ? body.uc : null;
  const campaign = typeof body.campaign === "string" ? body.campaign.slice(0, 120) : null;
  const source = typeof body.source === "string" ? body.source.slice(0, 120) : null;

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
    creativeId: uc,
    utmCampaign: campaign,
    utmSource: source,
  });

  return NextResponse.json({ ok: true });
}
