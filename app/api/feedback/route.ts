import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * In-product feedback.
 *
 * Called with the SESSION client, not the admin client, on purpose: the
 * database function reads auth.uid() and stamps the email and plan from the
 * server's own view of the account. Nothing the browser says about who it is or
 * what it pays is trusted — a bug report about plan gating is worthless if the
 * plan on it came from the client that thinks the gating is wrong.
 */

const BodySchema = z.object({
  message: z.string().trim().min(3).max(4000),
  kind: z.enum(["bug", "confusing", "idea", "praise"]).default("bug"),
  route: z.string().max(500).optional(),
  storeId: z.string().uuid().optional(),
  context: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("submit_feedback", {
    p_message: body.message,
    p_kind: body.kind,
    p_route: body.route ?? null,
    p_store_id: body.storeId ?? null,
    p_context: body.context ?? {},
  });

  /*
   * supabase-js resolves rather than throws, so an unchecked call here would
   * thank the sender and drop the message. During a test phase that is worse
   * than having no feedback button: the tester believes they have reported it.
   */
  if (error) {
    logger.error("Feedback submission failed", { userId: user.id, message: error.message });
    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }
  if (data === false) {
    // The function's own refusal — hourly cap, or a message too short.
    return NextResponse.json({ error: "REJECTED" }, { status: 429 });
  }

  return NextResponse.json({ ok: true });
}
