import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
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
 * Lets the founder review the designs before launch; also the visual check
 * for the templates.
 */
export default async function EmailPreviewPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-16">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50 transition-colors hover:text-ivory-100"
        >
          ← Workspace
        </Link>
      </div>
      <header className="border-b border-ivory-100/10 pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
          Internal
        </p>
        <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100">
          Email templates
        </h1>
        <p className="mt-2 text-sm font-light text-ivory-100/60">
          Preview of every transactional email. Sent via Resend once configured.
        </p>
      </header>

      <div className="mt-10 space-y-12">
        {previews.map((p) => (
          <section key={p.name}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-serif text-xl text-ivory-100">{p.name}</h2>
              <span className="font-mono text-xs text-ivory-100/40">{p.email.subject}</span>
            </div>
            <iframe
              title={p.name}
              srcDoc={p.email.html}
              className="h-[520px] w-full rounded-xl border border-ivory-100/10 bg-white"
            />
          </section>
        ))}
      </div>
    </main>
  );
}
