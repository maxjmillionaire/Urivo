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
          className="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          ← Workspace
        </Link>
      </div>
      <header className="border-b border-line pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Internal
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
          Email templates
        </h1>
        <p className="mt-2 text-sm text-muted">
          Preview of every transactional email. Sent via Resend once configured.
        </p>
      </header>

      <div className="mt-10 space-y-12">
        {previews.map((p) => (
          <section key={p.name}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold text-ink">{p.name}</h2>
              <span className="font-mono text-xs text-muted">{p.email.subject}</span>
            </div>
            <iframe
              title={p.name}
              srcDoc={p.email.html}
              className="h-[520px] w-full rounded-xl border border-line bg-white shadow-soft"
            />
          </section>
        ))}
      </div>
    </main>
  );
}
