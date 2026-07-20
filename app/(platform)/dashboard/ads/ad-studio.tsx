"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CREDIT_COSTS } from "@/lib/credit-costs";

/*
 * Ad Studio client. Generates a channel strategy + platform-ready creative for
 * the active store. Honest: this is strategy + copy — live performance analytics
 * needs a Google/Meta Ads connection, flagged in the UI.
 */

type Fit = "high" | "medium" | "low";
interface AdPlan {
  strategy: {
    primaryAngle: string;
    channels: { platform: string; fit: Fit; why: string; budgetHint: string }[];
    targeting: string[];
  };
  creatives: { platform: string; format: string; angle: string; headline: string; primaryText: string; cta: string }[];
}

const FIT_STYLE: Record<Fit, string> = {
  high: "border-live/30 bg-live/10 text-live",
  medium: "border-gold/30 bg-gold/[0.08] text-gold-soft",
  low: "border-hair-strong bg-white/[0.04] text-mist",
};

export function AdStudio({ store }: { store: { id: string; name: string } | null }) {
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!store || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/ads`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Ad Studio is unavailable right now.");
      setPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ad Studio hit a snag. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [store, busy]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  if (!store) {
    return (
      <div className="u-float mt-7 rounded-2xl border border-dashed border-hair-strong bg-panel/40 p-10 text-center">
        <p className="text-sm text-ivory">No store yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-mist">
          Generate a store first — Ad Studio writes creative from its brand and products.
        </p>
        <Link href="/dashboard" className="u-gold u-lift mt-5 inline-block rounded-lg px-4 py-2 text-xs font-semibold">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-7">
      <div className="u-float flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hair bg-panel/70 p-5">
        <div>
          <p className="text-sm font-medium text-ivory">{store.name}</p>
          <p className="text-xs text-mist-dim">
            Generate a fresh strategy + ad set for this store · {CREDIT_COSTS.adStudio} credits
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="u-gold u-lift rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Writing ads…" : plan ? "Regenerate" : "Generate ads"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
          {error}
        </p>
      )}

      {busy && (
        <div className="u-float mt-5 space-y-3 rounded-2xl border border-hair bg-panel/60 p-6">
          <div className="u-skel h-4 w-1/2 rounded" />
          <div className="u-skel h-20 w-full rounded-xl" />
          <div className="u-skel h-32 w-full rounded-xl" />
        </div>
      )}

      {plan && (
        <div className="u-enter mt-6">
          {/* Strategy */}
          <div className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Lead with this</p>
            <p className="mt-2 text-lg leading-relaxed text-ivory">{plan.strategy.primaryAngle}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {plan.strategy.channels.map((c) => (
                <div key={c.platform} className="rounded-xl border border-hair bg-night/60 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ivory">{c.platform}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${FIT_STYLE[c.fit]}`}>
                      {c.fit} fit
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-mist">{c.why}</p>
                  <p className="mt-2 font-mono text-[11px] text-gold-soft">{c.budgetHint}</p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Targeting angles</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {plan.strategy.targeting.map((t) => (
                  <span key={t} className="rounded-full border border-hair bg-panel/60 px-2.5 py-1 text-[11px] text-cloud">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Creatives */}
          <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Ready-to-run creative</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {plan.creatives.map((ad, i) => {
              const block = `${ad.headline}\n\n${ad.primaryText}\n\n${ad.cta}`;
              const key = `ad-${i}`;
              return (
                <div key={key} className="u-float flex flex-col rounded-xl border border-hair bg-panel/60 p-4">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-mist-dim">
                    <span className="text-gold-soft">{ad.platform}</span>
                    <span>{ad.format}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-snug text-ivory">{ad.headline}</p>
                  <p className="mt-1.5 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-mist">{ad.primaryText}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="rounded-md border border-gold/25 bg-gold/[0.06] px-2 py-1 text-[10px] font-semibold text-gold-soft">
                      {ad.cta}
                    </span>
                    <button
                      onClick={() => copy(block, key)}
                      className="u-press text-[11px] font-semibold text-mist transition-colors hover:text-ivory"
                    >
                      {copied === key ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-mist-dim">Angle — {ad.angle}</p>
                </div>
              );
            })}
          </div>

          {/* Honest analytics note */}
          <div className="u-float mt-6 rounded-2xl border border-hair bg-panel/50 p-5">
            <p className="text-sm font-medium text-ivory">Live performance analytics</p>
            <p className="mt-1.5 text-xs leading-relaxed text-mist">
              Real spend, CTR, CPA and ROAS come from connecting a Google or Meta Ads account — a one-click integration
              on the roadmap. Until then, Ad Studio delivers the strategy and creative; run them on your ad account and
              paste results back here when the connection lands.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
