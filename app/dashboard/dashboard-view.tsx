import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";
import { GenerateStorePanel } from "./generate-store-panel";

/*
 * Presentational dashboard shell (data-agnostic). The route fetches data and
 * passes it in; this component owns the layout so it can be reused and
 * previewed without a live session.
 */

export interface DashboardStore {
  id: string;
  storeName: string;
  subdomain: string;
  isActive: boolean;
  url: string;
}

export interface DashboardViewProps {
  fullName: string | null;
  email: string | null;
  planLabel: string;
  balance: number | null;
  stores: DashboardStore[];
}

const navLink =
  "rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-200 hover:bg-surface-muted";

export function DashboardView({ fullName, email, planLabel, balance, stores }: DashboardViewProps) {
  const canGenerate = (balance ?? 0) >= 10;

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      {/* Brand + nav */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div className="flex items-center gap-2.5">
          <Image src={logo} alt="Urivo" width={30} height={30} className="rounded-md" />
          <span className="text-lg font-semibold tracking-tight text-brand">Urivo</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
      </div>

      <header className="flex flex-col gap-6 pt-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Merchant workspace
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
            Welcome{fullName ? `, ${fullName}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted">{email}</p>
        </div>
        <GenerateStorePanel canGenerate={canGenerate} />
      </header>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Credits</p>
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-brand tabular-nums">
            {typeof balance === "number" ? balance : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Plan</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-ink">{planLabel}</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Your stores</h2>

        {stores.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-surface p-12 text-center shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Let&apos;s build your business
            </p>
            <h3 className="mx-auto mt-5 max-w-lg text-3xl font-semibold leading-tight tracking-tight text-ink">
              Your first store is one sentence away.
            </h3>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
              Describe what you want to sell — Urivo designs the brand, writes the catalog and
              builds a live storefront in under a minute.
            </p>
            <div className="mt-8 flex justify-center">
              <GenerateStorePanel canGenerate={canGenerate} />
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
                {stores.map((store) => (
                  <tr key={store.id} className="transition-colors hover:bg-surface-muted">
                    <td className="px-6 py-4 font-medium text-ink">{store.storeName}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted">{store.subdomain}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                          store.isActive ? "bg-success/10 text-[#15803d]" : "bg-surface-muted text-muted"
                        }`}
                      >
                        {store.isActive ? "Live" : "Paused"}
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
                        href={store.url}
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
