import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { captureException } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
