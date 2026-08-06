import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The feedback inbox. Read and triage only — feedback is never edited, because
 * what a tester actually wrote is the evidence, and an inbox you can rewrite is
 * a set of notes about an inbox.
 */

const ResolveSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

async function requireAdmin(): Promise<boolean> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user && isAdminEmail(user.email));
}

const notFound = () => NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return notFound();

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const { data, error } = await supabaseAdmin().rpc("feedback_inbox", {
    p_limit: Number.isFinite(limit) ? limit : 100,
  });
  if (error) {
    return NextResponse.json({ error: "READ_FAILED", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

/** Toggle resolved. Sending the same id twice reopens it — triage is not final. */
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return notFound();

  let body: z.infer<typeof ResolveSchema>;
  try {
    body = ResolveSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc("resolve_feedback", {
    p_id: body.id,
    p_note: body.note ?? null,
  });
  if (error) {
    return NextResponse.json({ error: "UPDATE_FAILED", detail: error.message }, { status: 500 });
  }
  if (data !== true) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
