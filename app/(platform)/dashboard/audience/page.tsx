import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { entitledPlan } from "@/lib/plans";
import { loadAudience } from "@/lib/marketing/audience";
import { AudienceView } from "./audience-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audience — Urivo" };

/*
 * The merchant's audience — the customer list Urivo captured on the storefront,
 * now visible, exportable, and mailable. A live store (hence any subscribers) is
 * a paid capability, so this is gated to Founder & Pro; a builder with no store
 * yet gets an honest empty state rather than a broken screen.
 */
export default async function AudiencePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, subscription_status, comped_until")
    .eq("id", user.id)
    .single();
  const plan = entitledPlan(profile);

  const { data: stores } = await supabase
    .from("stores")
    .select("id, store_name, subdomain, is_active")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const store = (stores ?? []).find((s) => s.is_active) ?? (stores ?? [])[0] ?? null;

  const header = (
    <header>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-gold" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Audience</p>
      </div>
      <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight text-ivory">
        Your customers, and a way to reach them.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
        Everyone who subscribed on your storefront — yours to see, export, and email. Urivo drafts the
        campaign; you approve it and send. Every message carries a one-click unsubscribe.
      </p>
    </header>
  );

  if (!plan.features.publish) {
    return (
      <>
        {header}
        <div className="u-float mt-8 rounded-2xl border border-hair bg-panel/70 p-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-soft">Founder &amp; Pro</p>
          <h2 className="mx-auto mt-3 max-w-md text-[22px] font-semibold leading-snug tracking-tight text-ivory">
            Turn storefront subscribers into repeat customers.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-mist">
            Publishing a store and building an audience starts on a paid plan. Upgrade to see your
            subscriber list, export it, and send AI-drafted campaigns.
          </p>
          <Link href="/dashboard/billing" className="u-gold u-lift mt-6 inline-flex rounded-xl px-6 py-3 text-sm font-semibold">
            See plans
          </Link>
        </div>
      </>
    );
  }

  if (!store) {
    return (
      <>
        {header}
        <div className="u-float mt-8 rounded-2xl border border-dashed border-hair-strong bg-panel/60 p-8 text-center">
          <p className="text-sm font-medium text-ivory">No store yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-mist">
            Generate and publish your first store — subscribers you collect on it will appear here.
          </p>
          <Link href="/dashboard" className="u-gold u-lift mt-5 inline-flex rounded-xl px-5 py-2.5 text-xs font-semibold">
            Go to dashboard
          </Link>
        </div>
      </>
    );
  }

  const audience = await loadAudience(store.id);

  return (
    <>
      {header}
      <AudienceView
        storeId={store.id}
        storeName={store.store_name}
        subdomain={store.subdomain}
        isLive={store.is_active}
        stats={audience.stats}
        subscribers={audience.subscribers.slice(0, 300)}
      />
    </>
  );
}
