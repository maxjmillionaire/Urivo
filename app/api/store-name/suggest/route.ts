import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { suggestStoreNames } from "@/lib/ai/name-studio";
import { resolveAvailableNames } from "@/lib/naming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Name Studio endpoint. Given an idea, returns brandable names that are ALREADY
 * confirmed available (each paired with a free subdomain). The founder picks a
 * name they love and knows they can have it — no dead ends. No credit charge;
 * naming is part of feeling taken care of.
 */

const BodySchema = z.object({
  prompt: z.string().trim().min(4, "Tell me a bit about the idea.").max(500),
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

  const limit = await rateLimit(`name-suggest:${user.id}`, 12, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "You're asking for names very quickly. Give it a moment." },
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
    const ideas = await suggestStoreNames({ prompt: body.prompt });
    const available = await resolveAvailableNames(supabaseAdmin(), ideas.names);
    // Surface the strongest handful of genuinely-available names.
    return NextResponse.json({ success: true, suggestions: available.slice(0, 6) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "AI_FAILED";
    if (code === "AI_NOT_CONFIGURED") return fail(503, "AI_UNAVAILABLE", "Name ideas aren't available just yet. Please try again shortly.");
    if (code === "AI_REFUSED") return fail(422, "AI_REFUSED", "I couldn't name that one — try describing the idea differently.");
    captureException(err, { requestId, userId: user.id, route: "store-name:suggest" });
    return fail(502, "AI_FAILED", "Name ideas hit a snag. Please try again.");
  }
}
