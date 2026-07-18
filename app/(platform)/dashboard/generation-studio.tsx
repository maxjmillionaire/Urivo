"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Generation Studio — the focused, full-screen creation experience.
 *
 * When a founder asks Urivo to build a store, the view flashes to full screen and
 * gives the moment its full attention: staged progress on the left, the store
 * forming on the right, a quiet way back to the dashboard while the work
 * continues. Premium and calm — never a spinner, never flashy. On completion the
 * real store blooms in with a single confident call to action.
 */

export interface StudioResult {
  storeName: string;
  tagline: string;
  storeUrl: string;
  palette: { background: string; structure: string; accent: string };
  products: { title: string; priceEUR: number }[];
  creditsRemaining: number;
}

const PHASES = [
  { title: "Reading your brief", note: "Understanding the brand, audience and intent" },
  { title: "Designing the identity", note: "Naming, voice and art direction" },
  { title: "Choosing type & colour", note: "A pairing and palette that fit the world" },
  { title: "Composing the layout", note: "Hero, grid, sections and rhythm" },
  { title: "Writing the collection", note: "Products, prices and considered copy" },
  { title: "Polishing the details", note: "Spacing, motion and the final finish" },
];

export function GenerationStudio({
  prompt,
  result,
  error,
  onOpenStore,
  onClose,
}: {
  prompt: string;
  result: StudioResult | null;
  error: string | null;
  onOpenStore: (url: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const done = !!result;

  // Advance phases on a gentle cadence, but never "complete" the last one until
  // the real result lands — the studio holds attention honestly.
  useEffect(() => {
    if (done || error) return;
    const id = setInterval(() => {
      setPhase((p) => (p < PHASES.length - 1 ? p + 1 : p));
    }, 1500);
    return () => clearInterval(id);
  }, [done, error]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (done) setPhase(PHASES.length);
  }, [done]);

  const activePhase = done ? PHASES.length : phase;
  const pct = Math.min(100, Math.round((activePhase / PHASES.length) * 100));

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-night text-ivory">
      {/* ambient depth */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(80% 55% at 20% 0%, rgba(36,50,76,0.5), rgba(11,18,32,0) 60%), radial-gradient(70% 50% at 100% 100%, rgba(232,205,128,0.06), rgba(11,18,32,0) 55%)",
        }}
      />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-5 py-4 sm:px-8">
        <button
          onClick={onClose}
          className="u-lift group inline-flex items-center gap-2 rounded-lg border border-hair bg-panel/60 px-3 py-2 text-xs font-medium text-mist transition-colors hover:border-hair-strong hover:text-ivory active:scale-[0.98]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Dashboard
        </button>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
          {!done && !error && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />}
          <span>{error ? "Generation paused" : done ? "Store ready" : "Urivo is building"}</span>
        </div>
        <span className="hidden font-mono text-[11px] text-mist-dim sm:block">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </div>

      <div className="u-enter relative mx-auto grid max-w-5xl gap-8 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:pt-12">
        {/* Left — brief + progress */}
        <div className="lg:pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mist">Your brief</p>
          <p className="mt-3 max-w-md text-lg leading-relaxed text-cloud">&ldquo;{prompt}&rdquo;</p>

          {error ? (
            <div className="u-float mt-8 rounded-2xl border border-alert/25 bg-alert/5 p-6">
              <p className="text-sm font-semibold text-alert">Generation didn&apos;t finish</p>
              <p className="mt-2 text-sm leading-relaxed text-mist">{error}</p>
              <button onClick={onClose} className="u-gold u-lift mt-5 rounded-lg px-4 py-2.5 text-sm font-semibold">
                Back to dashboard
              </button>
            </div>
          ) : (
            <>
              {/* progress bar */}
              <div className="mt-8 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{ width: `${pct}%`, backgroundImage: "var(--grad-gold)" }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-mist tabular-nums">{pct}%</span>
              </div>

              {/* phases */}
              <ul className="mt-6 space-y-1">
                {PHASES.map((p, i) => {
                  const state = i < activePhase ? "done" : i === activePhase ? "active" : "todo";
                  return (
                    <li
                      key={p.title}
                      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                        state === "active" ? "bg-white/[0.04]" : ""
                      }`}
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {state === "done" ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-gold" aria-hidden>
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : state === "active" ? (
                          <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ backgroundImage: "var(--grad-gold)" }} />
                        ) : (
                          <span className="h-2.5 w-2.5 rounded-full border border-hair-strong" />
                        )}
                      </span>
                      <span>
                        <span className={`block text-sm font-medium ${state === "todo" ? "text-mist-dim" : "text-ivory"}`}>
                          {p.title}
                        </span>
                        <span className="block text-xs text-mist">{p.note}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Right — the store forming / revealed */}
        <div className="lg:pt-6">
          <StagePreview result={result} />
          {done && result && (
            <div className="u-enter mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mist">Your store is live</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ivory">{result.storeName}</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-mist">{result.tagline}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => onOpenStore(result.storeUrl)} className="u-gold u-lift rounded-xl px-5 py-3 text-sm font-semibold">
                  Open your store
                </button>
                <button onClick={onClose} className="u-lift rounded-xl border border-hair bg-panel px-5 py-3 text-sm font-medium text-ivory transition-colors hover:border-hair-strong active:scale-[0.98]">
                  Back to dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StagePreview({ result }: { result: StudioResult | null }) {
  const scrollDone = useRef(false);
  useEffect(() => {
    if (result && !scrollDone.current) scrollDone.current = true;
  }, [result]);

  const p = result?.palette;
  return (
    <div className="u-float overflow-hidden rounded-2xl border border-hair bg-panel">
      {/* browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-hair/60 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-alert/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-live/70" />
        <span className="ml-2 truncate font-mono text-[10px] text-mist-dim">
          {result ? new URL(result.storeUrl, "https://urivo.ai").host : "building your store…"}
        </span>
      </div>

      {result && p ? (
        <div className="u-enter" style={{ backgroundColor: p.background }}>
          <div className="px-6 pt-6" style={{ color: p.structure }}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-60">Shop</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.accent }} />
            </div>
            <p className="mt-8 text-[9px] font-semibold uppercase tracking-[0.28em] opacity-50">New collection</p>
            <h3 className="mt-2 text-4xl font-semibold leading-none tracking-tight">{result.storeName}</h3>
            <p className="mt-3 text-xs italic opacity-70">{result.tagline}</p>
            <div className="mt-6 grid grid-cols-3 gap-3 pb-6">
              {(result.products.length ? result.products.slice(0, 3) : [0, 1, 2]).map((pr, i) => (
                <div key={i} className="rounded-lg p-2.5" style={{ backgroundColor: `${p.structure}10` }}>
                  <div className="aspect-[3/4] rounded" style={{ background: `linear-gradient(160deg, ${p.structure}14, ${p.accent}22)` }} />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="h-1 w-10 rounded-full" style={{ backgroundColor: `${p.structure}40` }} />
                    <span className="text-[8px] font-semibold" style={{ color: p.accent }}>
                      {typeof pr === "object" ? `€${pr.priceEUR}` : "€—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-6">
          <div className="u-skel h-3 w-24 rounded" />
          <div className="u-skel h-10 w-2/3 rounded-lg" />
          <div className="u-skel h-3 w-40 rounded" />
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div className="u-skel aspect-[3/4] rounded-lg" />
            <div className="u-skel aspect-[3/4] rounded-lg" />
            <div className="u-skel aspect-[3/4] rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
