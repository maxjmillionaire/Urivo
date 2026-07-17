import Link from "next/link";
import { IconRefresh, IconStore, IconBox, IconGlobe, IconCard, IconSpark } from "./icons";

/*
 * Home — present-tense, task-first. A quiet metric strip, an AI to-do band,
 * the plan, and the merchant's stores. The loud object (the live store) lives
 * in the companion rail; this surface stays calm and directive.
 */

export interface HomeStore {
  id: string;
  name: string;
  subdomain: string;
  isLive: boolean;
}

export interface DashboardHomeProps {
  fullName: string | null;
  credits: number | null;
  planLabel: string;
  hasPlan: boolean;
  liveStores: number;
  productCount: number;
  stores: HomeStore[];
  canGenerate: boolean;
}

const TASKS = [
  { key: "generate", label: "Generate a store", hint: "Describe it in one sentence", Icon: IconStore },
  { key: "products", label: "Add products", hint: "Let AI write the catalog", Icon: IconBox },
  { key: "domain", label: "Connect a domain", hint: "Go live on your own address", Icon: IconGlobe },
  { key: "plan", label: "Choose a plan", hint: "Unlock more credits", Icon: IconCard },
];

export function DashboardHome({
  fullName,
  credits,
  planLabel,
  hasPlan,
  liveStores,
  productCount,
  stores,
  canGenerate,
}: DashboardHomeProps) {
  const stat = (label: string, value: string, sub: string, gold?: boolean) => (
    <div className="px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-mist">{label}</p>
      <p className={`mt-2 text-[26px] font-semibold tabular-nums tracking-tight ${gold ? "u-gold-text" : "text-ivory"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-mist-dim">{sub}</p>
    </div>
  );

  return (
    <>
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ivory">
            Welcome back{fullName ? `, ${fullName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1.5 text-sm text-mist">Your commerce, running as one.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="u-lift inline-flex items-center gap-1.5 rounded-lg border border-hair bg-panel px-3 py-2 text-xs font-medium text-mist hover:border-hair-strong hover:text-ivory">
            <IconRefresh width={14} height={14} /> Refresh
          </button>
          <button
            type="button"
            disabled={!canGenerate}
            className="u-gold u-lift inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold hover:u-glow-gold disabled:opacity-50"
          >
            <IconSpark width={14} height={14} /> Generate store
          </button>
        </div>
      </div>

      {/* Metric strip */}
      <div className="u-float mt-7 grid grid-cols-2 divide-x divide-y divide-hair overflow-hidden rounded-2xl border border-hair bg-panel/70 sm:grid-cols-4 sm:divide-y-0">
        {stat("Credits", credits != null ? String(credits) : "—", "for new stores", true)}
        {stat("Live stores", String(liveStores), stores.length ? `of ${stores.length} total` : "none yet")}
        {stat("Products", String(productCount), "across all stores")}
        {stat("Plan", planLabel, hasPlan ? "active" : "no plan yet")}
      </div>

      {/* Guided setup + plan */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_264px]">
        <section className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
          <div className="flex items-center gap-2">
            <IconSpark className="text-gold" width={14} height={14} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
              Let Urivo take it from here
            </h2>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {TASKS.map(({ key, label, hint, Icon }) => (
              <button
                key={key}
                type="button"
                className="u-lift group flex items-center justify-between rounded-xl border border-hair bg-night px-4 py-3.5 text-left hover:border-hair-strong hover:bg-night-2"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/20 bg-gold/[0.06] text-gold">
                    <Icon width={16} height={16} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ivory">{label}</p>
                    <p className="text-[11px] text-mist-dim">{hint}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md border border-gold/25 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-gold-soft opacity-80 transition-opacity group-hover:opacity-100">
                  <IconSpark width={9} height={9} /> Automate
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="u-float flex flex-col rounded-2xl border border-hair bg-panel/70 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Your plan</p>
          <p className="mt-1 text-xs text-mist-dim">
            {hasPlan ? "Subscription active" : "You don't have a plan yet"}
          </p>
          <p className="mt-4 text-[34px] font-semibold leading-none tracking-tight text-ivory">{planLabel}</p>
          <div className="flex-1" />
          <Link
            href="/dashboard/billing"
            className="u-gold u-lift mt-6 rounded-lg px-4 py-2.5 text-center text-xs font-semibold hover:u-glow-gold"
          >
            {hasPlan ? "Manage plan" : "Upgrade"}
          </Link>
        </section>
      </div>

      {/* Stores */}
      <section id="stores" className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-ivory">Your stores</h2>
          {stores.length > 0 && (
            <span className="text-xs text-mist">{stores.length} total</span>
          )}
        </div>

        {stores.length === 0 ? (
          <div className="u-float mt-4 rounded-2xl border border-dashed border-hair-strong bg-panel/40 p-12 text-center">
            <h3 className="mx-auto max-w-md text-2xl font-semibold tracking-tight text-ivory">
              Your first store is one sentence away.
            </h3>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-mist">
              Describe what you want to sell — Urivo designs the brand, writes the catalog and builds
              a live storefront in under a minute.
            </p>
          </div>
        ) : (
          <div className="u-float mt-4 overflow-hidden rounded-2xl border border-hair bg-panel/70">
            <div className="divide-y divide-hair">
              {stores.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-hair bg-panel-2 text-mist">
                      <IconStore width={16} height={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ivory">{s.name}</p>
                      <p className="font-mono text-[11px] text-mist-dim">{s.subdomain}.urivo.ai</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        s.isLive ? "bg-live/10 text-live" : "bg-white/5 text-mist"
                      }`}
                    >
                      {s.isLive && <span className="h-1.5 w-1.5 rounded-full bg-live" />}
                      {s.isLive ? "Live" : "Paused"}
                    </span>
                    <Link
                      href={`/dashboard/stores/${s.id}`}
                      className="text-xs font-semibold text-gold-soft transition-colors hover:text-gold"
                    >
                      Manage →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
