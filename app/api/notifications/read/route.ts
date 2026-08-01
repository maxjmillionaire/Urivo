import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { markAllRead } from "@/lib/notifications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Mark all of the signed-in merchant's notifications as read (clears the bell). */
export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  await markAllRead(user.id);
  return NextResponse.json({ ok: true });
}
