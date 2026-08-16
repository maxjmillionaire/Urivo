import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(80).optional(),
  marketingOptIn: z.boolean().optional(),
});

/** Update the caller's own profile (display name, email preferences). */
export async function PATCH(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 });
  }

  let body: z.infer<typeof ProfileSchema>;
  try {
    body = ProfileSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid request." : "Invalid request.";
    return NextResponse.json({ error: "INVALID_INPUT", message }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.fullName !== undefined) update.full_name = body.fullName;
  if (body.marketingOptIn !== undefined) update.marketing_opt_in = body.marketingOptIn;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "INVALID_INPUT", message: "Nothing to update." }, { status: 400 });
  }

  // RLS ("profiles: own update") re-checks ownership at the row level.
  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: "INTERNAL", message: "Could not save your changes." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/*
 * Account deletion — DSGVO right to erasure (spec 6.7, screens §8).
 * Deleting the auth user cascades to profile, stores, products and ledger
 * via ON DELETE CASCADE. The caller can only delete their own account.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Please sign in." },
      { status: 401 },
    );
  }

  // Require an explicit typed confirmation to avoid accidental deletion.
  let confirm: string | undefined;
  try {
    confirm = (await request.json())?.confirm;
  } catch {
    confirm = undefined;
  }
  if (confirm !== "DELETE") {
    return NextResponse.json(
      { error: "CONFIRM_REQUIRED", message: "Type DELETE to confirm." },
      { status: 400 },
    );
  }

  try {
    const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch (err) {
    captureException(err, { userId: user.id, route: "account:delete" });
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not delete your account. Please try again." },
      { status: 500 },
    );
  }

  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
