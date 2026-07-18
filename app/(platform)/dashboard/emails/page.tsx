import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import {
  welcomeEmail,
  subscriptionConfirmedEmail,
  paymentSucceededEmail,
  paymentFailedEmail,
  subscriptionCancelledEmail,
} from "@/lib/email/templates";

export const dynamic = "force-dynamic";

/*
 * Founder-facing preview of every transactional email (auth-gated, not public).
 */
export default async function EmailPreviewPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, rail] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", user.id).single(),
    loadRailStore(user.id),
  ]);

  const previews = [
    { name: "Welcome", email: welcomeEmail("Max") },
    {
      name: "Subscription confirmed",
      email: subscriptionConfirmedEmail("Core", "You secured Founder Pricing — €49/month for the lifetime of your subscription."),
    },
    { name: "Payment succeeded", email: paymentSucceededEmail("€49.00") },
    { name: "Payment failed", email: paymentFailedEmail() },
    { name: "Subscription cancelled", email: subscriptionCancelledEmail() },
  ];

  return (
    <AppShell active="emails" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Internal</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Email templates</h1>
        <p className="mt-2 text-sm text-mist">Preview of every transactional email. Sent via Resend once configured.</p>
      </header>

      <div className="mt-8 space-y-10">
        {previews.map((p) => (
          <section key={p.name}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ivory">{p.name}</h2>
              <span className="font-mono text-xs text-mist-dim">{p.email.subject}</span>
            </div>
            <iframe
              title={p.name}
              srcDoc={p.email.html}
              className="u-float h-[520px] w-full rounded-2xl border border-hair bg-white"
            />
          </section>
        ))}
      </div>
    </AppShell>
  );
}
