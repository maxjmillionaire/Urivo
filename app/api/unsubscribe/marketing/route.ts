import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * One-click unsubscribe from Urivo marketing email — the weekly digest footer
 * link (public — the recipient may not be signed in). The token is the only
 * credential; the definer RPC sets profiles.marketing_opt_in = false by token
 * and is idempotent, so a second click is fine. The page always confirms,
 * whether or not the token matched, so it can't be used as an address oracle.
 *
 * This affects marketing consent ONLY. Transactional and service email
 * (account, billing, order, security) is unaffected.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, message: string): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} · Urivo</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f5f7;color:#18202e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px}
  .card{max-width:420px;width:100%;background:#fff;border:1px solid #e6e8ec;border-radius:16px;padding:34px 32px;text-align:center;box-shadow:0 20px 48px -28px rgba(15,23,42,0.2)}
  h1{font-size:19px;margin:0 0 10px;letter-spacing:-0.2px}
  p{font-size:14px;line-height:1.6;color:#57616f;margin:0}
  .mark{font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#a2793d;margin:0 0 16px}
  @media (prefers-color-scheme:dark){body{background:#0d121b;color:#e6eaf1}.card{background:#141b26;border-color:#253040}p{color:#9aa4b3}}
</style>
</head><body><div class="card"><p class="mark">Urivo</p><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!UUID.test(token)) {
    return page("Link not recognised", "That unsubscribe link isn't valid. You can also manage email preferences in your Urivo settings.");
  }

  try {
    // The boolean result is deliberately ignored — the confirmation is the same
    // whether or not the token matched, so the page is not an address oracle.
    await supabaseAdmin().rpc("unsubscribe_marketing_by_token", { p_token: token });
  } catch (err) {
    captureException(err, { requestId: newRequestId(), route: "unsubscribe-marketing" });
    return page("Something went wrong", "We couldn't process that just now. Please open the link again in a moment.");
  }

  return page("You're unsubscribed", "You won't receive Urivo's weekly updates any more. You can turn them back on anytime from your Urivo settings.");
}
