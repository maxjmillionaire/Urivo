import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { suggestStoreNames, NAME_STYLES, type NameStyle } from "@/lib/ai/name-studio";
import { resolveAvailableNames } from "@/lib/naming";
import { firstAvailableDomain, type DomainResult } from "@/lib/naming/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Intelligent brand-naming. Generates agency-grade names in a chosen style, then
 * checks BOTH the Urivo address (subdomain) AND a real registrable domain for
 * each — ranking names the founder can actually own to the top, .com first. The
 * "regenerate" call passes the names already seen so the next set is fresh.
 * No credit charge — naming is part of feeling taken care of.
 */

const BodySchema = z.object({
  prompt: z.string().trim().min(3, "Tell me a bit about the brand.").max(500),
  style: z.enum(NAME_STYLES).optional(),
  avoid: z.array(z.string().max(40)).max(24).optional(),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

const domainRank = (d: DomainResult | null): number => {
  if (!d || d.status !== "available") return 99;
  const i = ["com", "ai", "co", "shop", "store", "io"].indexOf(d.tld);
  return i < 0 ? 50 : i;
};

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "UNAUTHORIZED", "Please sign in.");

  const limit = await rateLimit(`brand-names:${user.id}`, 10, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're generating names quickly — give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return fail(400, "INVALID_INPUT", message);
  }

  const requestId = newRequestId();
  try {
    const ideas = await suggestStoreNames({ prompt: body.prompt, style: body.style as NameStyle | undefined, avoid: body.avoid });

    // Urivo address (subdomain) for each, and a real ownable domain in parallel.
    const [subdomains, domains] = await Promise.all([
      resolveAvailableNames(supabaseAdmin(), ideas.names),
      Promise.all(ideas.names.slice(0, 10).map((n) => firstAvailableDomain(n.name).catch(() => null))),
    ]);
    const subBy = new Map(subdomains.map((s) => [s.name, s.subdomain]));

    const suggestions = ideas.names.slice(0, 10).map((n, i) => ({
      name: n.name,
      rationale: n.rationale,
      subdomain: subBy.get(n.name) ?? null,
      domain: domains[i],
      ownable: domains[i]?.status === "available",
    }));

    // Own-a-real-domain first (.com before .ai …), then a free Urivo address.
    suggestions.sort((a, b) => domainRank(a.domain) - domainRank(b.domain) || (a.subdomain ? 0 : 1) - (b.subdomain ? 0 : 1));

    return NextResponse.json({ success: true, style: body.style ?? "premium", suggestions: suggestions.slice(0, 8) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_NOT_CONFIGURED") return fail(503, "AI_UNAVAILABLE", "Name ideas aren't available just yet. Please try again shortly.");
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't name that one — try describing the brand differently.");
    captureException(err, { requestId, userId: user.id, route: "brand:names" });
    return fail(502, "AI_FAILED", "Name ideas hit a snag. Please try again.");
  }
}
