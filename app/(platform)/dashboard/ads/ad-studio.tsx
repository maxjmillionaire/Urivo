"use client";

import { useCallback, useEffect, useState } from "react";
import { AttachButton } from "../_shell/attach";

interface CreativePerf {
  creativeId: string;
  platform: string;
  headline: string;
  angle: string;
  clicks: number;
  orders: number;
  revenueEUR: number;
  conversionPct: number | null;
  /** Present for every saved ad, so a link is never more than one click away. */
  trackingUrl?: string;
}

interface TrackingGap {
  tone: "warn" | "ok";
  title: string;
  detail: string;
}

interface Bucket { orders: number; revenueEUR: number }
interface Coverage {
  attributed: Bucket;
  returning: Bucket;
  expired: Bucket;
  unattributed: Bucket;
  unknown: Bucket;
  total: Bucket;
  coveragePct: number | null;
  days: number;
  available: boolean;
}
import type { Attachment } from "@/lib/ai/attachments";
import Link from "next/link";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { RevealStagger } from "../../_motion/reveal-stagger";

/*
 * Ad Studio client. Generates a channel strategy + platform-ready creative for
 * the active store, and reports what each ad measurably did — clicks, orders
 * and revenue joined server-side, with no ad-account connection and no pixel.
 *
 * Every saved ad keeps its tracking link here permanently. That link is the
 * single manual step in the whole chain, so the interface treats it as part of
 * the ad rather than an extra: shown in full, included in "copy all", and
 * reachable from the results table long after the plan that produced it is gone.
 */

type Fit = "high" | "medium" | "low";
interface AdPlan {
  strategy: {
    primaryAngle: string;
    channels: { platform: string; fit: Fit; why: string; budgetHint: string }[];
    targeting: string[];
  };
  creatives: {
    platform: string;
    format: string;
    angle: string;
    headline: string;
    primaryText: string;
    cta: string;
    /** Set once the ad has been persisted — absent only if saving failed. */
    trackingUrl?: string;
  }[];
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [adjusted, setAdjusted] = useState<string[]>([]);
  const [perf, setPerf] = useState<CreativePerf[]>([]);
  const [tracking, setTracking] = useState<TrackingGap | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [coverageNote, setCoverageNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"google" | "meta" | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!store || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/stores/${store.id}/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachments: attachments.length ? attachments : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Ad Studio is unavailable right now.");
      setPlan(data.plan);
      setAdjusted(data.adjusted ?? []);
      void loadPerf();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ad Studio hit a snag. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [store, busy]);

  const loadPerf = useCallback(async () => {
    if (!store) return;
    try {
      const res = await fetch(`/api/stores/${store.id}/ads`);
      if (!res.ok) return;
      const data = await res.json();
      setPerf((data.creatives ?? []) as CreativePerf[]);
      setTracking((data.tracking ?? null) as TrackingGap | null);
      setCoverage((data.coverage ?? null) as Coverage | null);
      setCoverageNote((data.coverageNote ?? null) as string | null);
    } catch {
      /* the panel simply stays empty */
    }
  }, [store]);

  useEffect(() => {
    void loadPerf();
  }, [loadPerf]);

  /*
   * Download the ad platform's own import file. The response is either a CSV
   * or a 200 explaining why there is nothing to export — a set with no Google
   * ads in it is a fact about the plan, not a failure to report as an error.
   */
  async function exportAds(format: "google" | "meta") {
    if (!store || exporting) return;
    setExporting(format);
    setExportNote(null);
    try {
      const res = await fetch(`/api/stores/${store.id}/ads/export?format=${format}`);
      const type = res.headers.get("Content-Type") ?? "";
      if (!res.ok || !type.includes("csv")) {
        const data = await res.json().catch(() => null);
        setExportNote(data?.note ?? data?.message ?? "That export could not be built. Please try again.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${format}-ads.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      const ads = res.headers.get("X-Urivo-Ads") ?? "";
      setExportNote(
        format === "google"
          ? "Downloaded. Import it in Google Ads Editor — it arrives paused, with your tracked link already set as the final URL."
          : `Downloaded ${ads} ${ads === "1" ? "ad" : "ads"}. Import it in Meta Ads Manager — everything arrives paused, each ad with its own tracked link.`,
      );
    } catch {
      setExportNote("That export could not be built. Please try again.");
    } finally {
      setExporting(null);
    }
  }

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
      <div className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="mt-4 border-t border-hair pt-4">
          <AttachButton
            attachments={attachments}
            onChange={setAttachments}
            disabled={busy}
            hint="Attach existing creatives, UGC videos, product photos or a competitor's ad — Urivo critiques what you have before writing what beats it."
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
          {error}
        </p>
      )}

      {adjusted.length > 0 && (
        <div className="mt-4 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-xs text-cloud">
          <p className="font-medium text-ivory">Some copy was shortened to fit its platform.</p>
          <ul className="mt-1 space-y-0.5 text-mist">
            {[...new Set(adjusted)].map((a) => (
              <li key={a}>· {a}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        * The tracking link is the one step Urivo cannot do for the merchant,
        * and getting it wrong fails silently — ads run, visitors arrive, every
        * ad reads zero forever, and the merchant concludes the ads failed when
        * the measurement did. This is the only place that can tell them apart.
        */}
      {tracking && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 ${
            tracking.tone === "warn" ? "border-gold/30 bg-gold/[0.07]" : "border-live/25 bg-live/[0.06]"
          }`}
        >
          <p className={`text-xs font-semibold ${tracking.tone === "warn" ? "text-gold-soft" : "text-live"}`}>
            {tracking.title}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-mist">{tracking.detail}</p>
        </div>
      )}

      {busy && (
        <div className="u-float mt-5 space-y-3 rounded-2xl border border-hair bg-panel/60 p-6">
          <div className="u-skel h-4 w-1/2 rounded" />
          <div className="u-skel h-20 w-full rounded-xl" />
          <div className="u-skel h-32 w-full rounded-xl" />
        </div>
      )}

      {/*
        * Measured, not modelled. Urivo owns the storefront that receives
        * the click and the order that closes the sale, so this join is
        * exact — no pixel to be blocked, no third party.
        */}
      <div className="u-float mt-6 rounded-2xl border border-hair bg-panel/50 p-5">
        <p className="text-sm font-medium text-ivory">Your ads — links and results</p>
        {perf.length === 0 ? (
          <p className="mt-1.5 text-xs leading-relaxed text-mist">
            Generate an ad set and every ad lands here with its own tracking link, permanently. Put that link in your
            campaign and this fills in by itself — clicks, orders and revenue per ad, measured against your real
            storefront. No pixel, no ad-account connection: Urivo already owns both ends of the journey. The next plan
            you generate reads these results and beats them.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-xs leading-relaxed text-mist">
              Every ad you have generated, with the link that measures it. Grab a link here any time — you never need
              to regenerate an ad to get it back.
            </p>

            {/*
              * Spec 10 §14. The figures below are never shown alone. A merchant
              * reading "€258 from your ads" concludes their ads produced €258;
              * reading it beside the €340 we could not credit, they reason
              * correctly — and the split tells them WHICH problem they have,
              * which is a different fix in each case. No ad platform reports
              * its own blind spots. That is exactly the point.
              */}
            {coverage?.available && coverage.total.orders > 0 && (
              <div className="mt-4 rounded-xl border border-hair bg-night/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">
                    Attribution coverage · last {coverage.days} days
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-ivory">
                    {coverage.coveragePct === null ? "—" : `${coverage.coveragePct}%`}
                  </p>
                </div>

                {/* Proportional, so the gap is seen before it is read. */}
                <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  {(
                    [
                      ["attributed", coverage.attributed.revenueEUR, "bg-gold"],
                      ["returning", coverage.returning.revenueEUR, "bg-live/70"],
                      ["expired", coverage.expired.revenueEUR, "bg-mist/50"],
                      ["unattributed", coverage.unattributed.revenueEUR, "bg-white/15"],
                      // Alert-toned on purpose: unknown revenue is our fault,
                      // not a fact about the merchant's marketing.
                      ["unknown", coverage.unknown.revenueEUR, "bg-alert/50"],
                    ] as const
                  ).map(([key, value, tone]) =>
                    value > 0 && coverage.total.revenueEUR > 0 ? (
                      <div
                        key={key}
                        className={tone}
                        style={{ width: `${(value / coverage.total.revenueEUR) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
                  {(
                    [
                      ["Attributed to an ad", coverage.attributed, "text-gold-soft"],
                      ["Returning customers", coverage.returning, "text-live"],
                      ["Outside the window", coverage.expired, "text-mist"],
                      ["No tracked link", coverage.unattributed, "text-mist"],
                      ["Could not assess", coverage.unknown, "text-alert"],
                    ] as const
                  ).map(([label, b, tone]) => (
                    <div key={label}>
                      <dt className="text-[10px] uppercase tracking-wider text-mist-dim">{label}</dt>
                      <dd className={`mt-0.5 text-xs font-semibold tabular-nums ${tone}`}>
                        €{b.revenueEUR.toFixed(2)}
                        <span className="ml-1 font-normal text-mist-dim">
                          · {b.orders} {b.orders === 1 ? "order" : "orders"}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>

                {coverageNote && (
                  <p className="mt-3 border-t border-hair pt-2.5 text-[11px] leading-relaxed text-mist">
                    {coverageNote}
                  </p>
                )}
              </div>
            )}

            {coverage && !coverage.available && (
              <p className="mt-3 rounded-xl border border-hair bg-night/40 px-3 py-2 text-[11px] leading-relaxed text-mist">
                Coverage could not be read, so the figures below are shown without it. Treat them as a floor rather
                than a total — they cannot tell you what share of your sales came from ads.
              </p>
            )}

            {/*
              * The last stretch of copy-paste, removed. Twenty fields per ad
              * become one file, and because the tracked link is written in as
              * the destination, a merchant who exports never types a URL — the
              * one step that silently breaks measurement stops existing.
              */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hair pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mist-dim">
                Import into
              </span>
              {(
                [
                  ["google", "Google Ads Editor"],
                  ["meta", "Meta Ads Manager"],
                ] as const
              ).map(([format, label]) => (
                <button
                  key={format}
                  onClick={() => exportAds(format)}
                  disabled={exporting !== null}
                  className="u-press inline-flex items-center gap-1.5 rounded-lg border border-hair px-2.5 py-1.5 text-[11px] font-semibold text-cloud transition-colors hover:border-gold/40 hover:text-ivory disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" />
                  </svg>
                  {exporting === format ? "Building…" : label}
                </button>
              ))}
              <span className="text-[10px] text-mist-dim">Free · arrives paused</span>
            </div>
            {exportNote && <p className="mt-2 text-[11px] leading-relaxed text-mist">{exportNote}</p>}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-mist-dim">
                  <tr>
                    {["Ad", "Platform", "Clicks", "Orders", "Revenue", "Conv.", "Link"].map((h, i) => (
                      <th
                        key={h}
                        className={`border-b border-hair pb-2 pr-3 font-medium ${i > 1 && i < 6 ? "text-right" : ""} ${i === 6 ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perf.map((c) => (
                    <tr key={c.creativeId} className="border-b border-hair/40">
                      <td className="max-w-[16rem] truncate py-2 pr-3 text-ivory/90" title={c.headline}>
                        {c.headline}
                      </td>
                      <td className="py-2 pr-3 text-mist">{c.platform}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-mist">{c.clicks}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-mist">{c.orders}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ivory/90">
                        €{c.revenueEUR.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-mist">
                        {c.conversionPct === null ? "—" : `${c.conversionPct}%`}
                      </td>
                      <td className="py-2 text-right">
                        {c.trackingUrl ? (
                          <button
                            onClick={() => copy(c.trackingUrl as string, `perf-${c.creativeId}`)}
                            title={c.trackingUrl}
                            className="u-press whitespace-nowrap rounded-md border border-hair px-2 py-1 text-[10px] font-semibold text-gold-soft transition-colors hover:border-gold/40 hover:text-gold"
                          >
                            {copied === `perf-${c.creativeId}` ? "Copied ✓" : "Copy"}
                          </button>
                        ) : (
                          <span className="text-mist-dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {plan && (
        <RevealStagger className="mt-6">
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
              const key = `ad-${i}`;
              /*
               * Labelled to match the fields of the form the merchant is about
               * to fill in, and the URL is part of it. Someone who copies the
               * whole block still ends up with the tracked link in hand — the
               * lazy path and the correct path are the same path.
               */
              const block = [
                `Headline: ${ad.headline}`,
                `Primary text: ${ad.primaryText}`,
                `Call to action: ${ad.cta}`,
                ad.trackingUrl ? `Website URL: ${ad.trackingUrl}` : null,
              ]
                .filter(Boolean)
                .join("\n\n");
              return (
                <div key={key} className="u-float flex flex-col rounded-xl border border-hair bg-panel/60 p-4">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-mist-dim">
                    <span className="text-gold-soft">{ad.platform}</span>
                    <span>{ad.format}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-snug text-ivory">{ad.headline}</p>
                  <p className="mt-1.5 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-mist">{ad.primaryText}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="rounded-md border border-gold/25 bg-gold/[0.06] px-2 py-1 text-[10px] font-semibold text-gold-soft">
                      {ad.cta}
                    </span>
                    <button
                      onClick={() => copy(block, key)}
                      className="u-press whitespace-nowrap text-[11px] font-semibold text-mist transition-colors hover:text-ivory"
                    >
                      {copied === key ? "Copied ✓" : "Copy all fields"}
                    </button>
                  </div>

                  {/*
                    * The destination URL is a field of the ad, not an optional
                    * extra — so it is shown as one, spelled out rather than
                    * hidden behind a button. A merchant who cannot see the link
                    * types in their store address instead, and the ad becomes
                    * unmeasurable without anything ever appearing to go wrong.
                    */}
                  {ad.trackingUrl ? (
                    <div className="mt-3 rounded-lg border border-gold/25 bg-gold/[0.05] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-soft">
                          Website URL
                        </span>
                        <button
                          onClick={() => copy(ad.trackingUrl as string, `${key}-link`)}
                          className="u-press whitespace-nowrap text-[10px] font-semibold text-gold-soft transition-colors hover:text-gold"
                        >
                          {copied === `${key}-link` ? "Copied ✓" : "Copy link"}
                        </button>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-cloud" title={ad.trackingUrl}>
                        {ad.trackingUrl}
                      </p>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-mist-dim">
                        Use this as the destination — not your plain store address. It is what credits the clicks and
                        sales below to this exact ad.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-hair bg-night/40 p-2.5 text-[10px] leading-relaxed text-mist">
                      This ad could not be saved, so it has no tracking link. The copy above still works — regenerate
                      when you want it measured.
                    </p>
                  )}

                  <p className="mt-2 text-[10px] text-mist-dim">Angle — {ad.angle}</p>
                </div>
              );
            })}
          </div>

        </RevealStagger>
      )}
    </div>
  );
}
