import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getCreditBalance } from "@/lib/credits";
import { env } from "@/lib/env";
import { GenerateStorePanel } from "./generate-store-panel";

export const dynamic = "force-dynamic";

function storeUrl(subdomain: string): string {
  const { ROOT_DOMAIN, NODE_ENV } = env();
  if (NODE_ENV !== "production" || ROOT_DOMAIN.startsWith("localhost")) {
    return `/store/${subdomain}`;
  }
  return `https://${subdomain}.${ROOT_DOMAIN}`;
}

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, balance, { data: stores }] = await Promise.all([
    supabase
      .from("profiles")
      .select("email, full_name, plan")
      .eq("id", user.id)
      .single(),
    getCreditBalance(user.id),
    supabase
      .from("stores")
      .select("id, store_name, subdomain, is_active, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const planLabel =
    profile?.plan === "core" ? "Core" : profile?.plan === "pro" ? "Pro" : "Free";
  const storeList = stores ?? [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <header className="flex flex-col gap-6 border-b border-ivory-100/10 pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
            Merchant workspace
          </p>
          <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
          </h1>
          <p className="mt-2 text-sm font-light text-ivory-100/60">
            {profile?.email ?? user.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <GenerateStorePanel canGenerate={balance >= 10} />
          <Link
            href="/dashboard/evolution"
            className="rounded-lg border border-gold-500/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300 transition-colors duration-200 hover:border-gold-500 hover:text-champagne"
          >
            ✦ Evolution Lab
          </Link>
          <Link
            href="/dashboard/billing"
            className="rounded-lg border border-ivory-100/15 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors duration-200 hover:border-ivory-100/30 hover:text-ivory-100"
          >
            Billing
          </Link>
          <Link
            href="/dashboard/settings"
            className="rounded-lg border border-ivory-100/15 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors duration-200 hover:border-ivory-100/30 hover:text-ivory-100"
          >
            Settings
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-ivory-100/15 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors duration-200 hover:border-ivory-100/30 hover:text-ivory-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gold-500/20 bg-forest-950 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Credits
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-gold-300">
            {typeof balance === "number" ? balance : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-ivory-100/10 bg-ivory-100/5 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Plan
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-ivory-100">
            {planLabel}
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-normal text-ivory-100">
          Your stores
        </h2>

        {storeList.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-gold-500/20 bg-ivory-100/5 p-12 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
              Let's build your business
            </p>
            <h3 className="mx-auto mt-5 max-w-lg font-serif text-3xl font-normal leading-tight text-ivory-100">
              Your first store is one sentence away.
            </h3>
            <p className="mx-auto mt-4 max-w-md text-sm font-light leading-relaxed text-ivory-100/60">
              Describe what you want to sell — Urivo designs the brand, writes
              the catalog and builds a live storefront in under a minute.
            </p>
            <div className="mt-8 flex justify-center">
              <GenerateStorePanel canGenerate={balance >= 10} />
            </div>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-ivory-100/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-ivory-100/5 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50">
                  <th className="px-6 py-4">Store</th>
                  <th className="px-6 py-4">Address</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ivory-100/5">
                {storeList.map((store) => (
                  <tr
                    key={store.id}
                    className="transition-colors hover:bg-ivory-100/5"
                  >
                    <td className="px-6 py-4 font-medium text-ivory-100">
                      {store.store_name}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ivory-100/60">
                      {store.subdomain}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                          store.is_active
                            ? "bg-success-dark/10 text-success-dark"
                            : "bg-ivory-100/10 text-ivory-100/50"
                        }`}
                      >
                        {store.is_active ? "Live" : "Paused"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/dashboard/stores/${store.id}`}
                        className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300 underline-offset-4 hover:underline"
                      >
                        Manage
                      </Link>
                      <a
                        href={storeUrl(store.subdomain)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60 underline-offset-4 hover:text-ivory-100 hover:underline"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
