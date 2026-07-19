import Link from "next/link";
import { GenerateStorePanel } from "../generate-store-panel";
import { IconStore, IconCard, IconSpark, IconResearch, IconMegaphone, IconEvolution, IconArrow } from "./icons";

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
  { href: "/dashboard/research", label: "Research the market", hint: "Find a winning niche and products", Icon: IconResearch },
  { href: "/dashboard/ads", label: "Ad Studio", hint: "Channel strategy and ready-to-run creative", Icon: IconMegaphone },
  { href: "/dashboard/evolution", label: "Evolution Lab", hint: "Evolve a stronger storefront", Icon: IconEvolution },
  { href: "/dashboard/billing", label: "Plans and credits", hint: "Unlock more generations", Icon: IconCard },
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
        <GenerateStorePanel canGenerate={canGenerate} />
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
              Where to next
            </h2>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {TASKS.map(({ href, label, hint, Icon }) => (
              <Link
                key={href}
                href={href}
                className="u-lift group flex items-center justify-between rounded-xl border border-hair bg-night px-4 py-3.5 text-left transition-colors hover:border-hair-strong hover:bg-night-2"
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
                <IconArrow width={16} height={16} className="text-mist-dim transition-colors group-hover:text-gold-soft" />
              </Link>
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
          <div className="u-float mt-4 overflow-hidden rounded-2xl border border-hair bg-panel/60 p-10 text-center sm:p-14">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-gold/20 bg-gold/[0.06] text-gold">
              <IconSpark width={22} height={22} />
            </span>
            <h3 className="mx-auto mt-6 max-w-md text-[26px] font-semibold tracking-tight text-ivory">
              Your first store is one sentence away.
            </h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-mist">
              Describe what you want to sell — Urivo researches the market, designs the brand, writes the
              catalog and builds a live storefront in under a minute.
            </p>
            <div className="mx-auto mt-7 flex max-w-md flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-medium uppercase tracking-[0.1em] text-mist-dim">
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-gold" /> A unique brand</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-gold" /> Real product photos</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-gold" /> Live in a minute</span>
            </div>
            <div className="mt-8 flex justify-center">
              <GenerateStorePanel
                canGenerate={canGenerate}
                autoOpenFromIdea={false}
                triggerLabel="Generate your first store"
                triggerClassName="u-gold u-lift inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold"
              />
            </div>
            {!canGenerate && (
              <p className="mt-4 text-xs text-mist-dim">
                You&apos;ll need credits to generate —{" "}
                <Link href="/dashboard/billing" className="text-gold-soft underline-offset-4 hover:underline">see plans</Link>.
              </p>
            )}
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
