import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { runMarketResearch } from "@/lib/ai/market-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Market Research endpoint. Authenticated + rate-limited. Returns a structured,
 * validated market report. No credits are charged — this is top-of-funnel and
 * meant to be used freely before a founder commits credits to a generation.
 */

const BodySchema = z.object({
  prompt: z.string().trim().min(4, "Tell me a bit more about the niche or idea.").max(500),
});

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "UNAUTHORIZED", "Please sign in.");

  const limit = await rateLimit(`research:${user.id}`, 10, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're researching very quickly. Give it a moment." },
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
    const report = await runMarketResearch({ prompt: body.prompt });
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_NOT_CONFIGURED") return fail(503, "AI_UNAVAILABLE", "Research isn't available just yet. Please try again shortly.");
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't research that one — try describing the niche differently.");
    captureException(err, { requestId, userId: user.id, route: "research" });
    return fail(502, "AI_FAILED", "Research hit a snag. Please try again.");
  }
}
