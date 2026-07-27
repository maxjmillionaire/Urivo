import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { setFreeGenerationsEnabled } from "@/lib/platform/settings";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Admin platform controls (part 2.4). Currently the free-generation kill switch.
 * Gated on the admin allow-list; 404 (not 403) so the route isn't discoverable.
 */

const BodySchema = z.object({ freeGenerationsEnabled: z.boolean() });

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    await setFreeGenerationsEnabled(body.freeGenerationsEnabled);
    logger.warn("Admin toggled free generations", {
      admin: user.email,
      freeGenerationsEnabled: body.freeGenerationsEnabled,
    });
    return NextResponse.json({ ok: true, freeGenerationsEnabled: body.freeGenerationsEnabled });
  } catch {
    return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
  }
}
