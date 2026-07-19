import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "./service";
import { welcomeEmail } from "./templates";
import { captureException } from "@/lib/monitoring";

/*
 * Send the welcome email exactly once per user. The `welcomed_at` flag is set
 * atomically (update … where welcomed_at is null returning), so two concurrent
 * requests can never both send — only the update that flips the flag proceeds.
 * Best-effort: never throws into the calling flow.
 */
export async function sendWelcomeIfFirstTime(userId: string, email: string | null, name?: string | null) {
  if (!email) return;
  try {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from("profiles")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", userId)
      .is("welcomed_at", null)
      .select("id")
      .maybeSingle();

    if (!data) return; // already welcomed (or no row flipped)
    await sendEmail({ to: email, email: welcomeEmail(name ?? undefined) });
  } catch (err) {
    captureException(err, { route: "email:welcome", userId });
  }
}
