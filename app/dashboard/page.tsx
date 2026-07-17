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

const navLink =
  "rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-200 hover:bg-surface-muted";

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
      <header className="flex flex-col gap-6 border-b border-line pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Merchant workspace
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {profile?.email ?? user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <GenerateStorePanel canGenerate={balance >= 10} />
          <Link href="/dashboard/evolution" className={navLink}>
            Evolution Lab
          </Link>
          <Link href="/dashboard/billing" className={navLink}>
            Billing
          </Link>
          <Link href="/dashboard/settings" className={navLink}>
            Settings
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className={navLink}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Credits
            </p>
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-brand tabular-nums">
            {typeof balance === "number" ? balance : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Plan
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-ink">
            {planLabel}
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Your stores
        </h2>

        {storeList.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-surface p-12 text-center shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Let&apos;s build your business
            </p>
            <h3 className="mx-auto mt-5 max-w-lg text-3xl font-semibold leading-tight tracking-tight text-ink">
              Your first store is one sentence away.
            </h3>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
              Describe what you want to sell — Urivo designs the brand, writes
              the catalog and builds a live storefront in under a minute.
            </p>
            <div className="mt-8 flex justify-center">
              <GenerateStorePanel canGenerate={balance >= 10} />
            </div>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-6 py-4">Store</th>
                  <th className="px-6 py-4">Address</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {storeList.map((store) => (
                  <tr
                    key={store.id}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-6 py-4 font-medium text-ink">
                      {store.store_name}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted">
                      {store.subdomain}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                          store.is_active
                            ? "bg-success/10 text-[#15803d]"
                            : "bg-surface-muted text-muted"
                        }`}
                      >
                        {store.is_active ? "Live" : "Paused"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/dashboard/stores/${store.id}`}
                        className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
                      >
                        Manage
                      </Link>
                      <a
                        href={storeUrl(store.subdomain)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-4 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
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
