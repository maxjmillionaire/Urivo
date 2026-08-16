"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EvolutionRun } from "@/lib/evolution/engine";
import { buildFinalists, type Finalist } from "@/lib/evolution/champions";
import { prefersReducedMotion } from "../../_motion/motion";

/*
 * The Winning Store Reveal — the emotional climax of Evolution.
 *
 * After the competition tree converges, this presents the decision like a
 * product launch, not a loading screen. The finalists stay on stage; the AI
 * visibly analyses them, scores appear, weak candidates recede one by one, the
 * field narrows to two, a beat of silence, then the winner is crowned with a
 * growing gold outline and a single pass of gold light. It never says "winner"
 * without explaining why — reasons, a five-star Urivo Score and a confidence
 * figure the founder can trust. Calm, deliberate, premium confidence. ~5.5s.
 *
 * Reduced motion → the settled verdict is shown immediately, no sequence.
 */

type Stage = "analyzing" | "eliminating" | "finaltwo" | "crowning" | "revealed";

const THINKING = [
  "Comparing branding…",
  "Checking product quality…",
  "Analyzing supplier reliability…",
  "Estimating conversion potential…",
  "Calculating margins…",
  "Evaluating shipping…",
  "Predicting customer demand…",
];

export function ChampionReveal({ run, tier = "standard" }: { run: EvolutionRun; tier?: "standard" | "advanced" }) {
  const router = useRouter();
  const finalists = useMemo(() => buildFinalists(run, 6), [run]);
  const winner = finalists[0];

  const [stage, setStage] = useState<Stage>("analyzing");
  const [eliminated, setEliminated] = useState<Set<string>>(new Set());
  const [scored, setScored] = useState(false);
  const [thinking, setThinking] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduce = prefersReducedMotion();
    if (reduce) {
      setEliminated(new Set(finalists.slice(1).map((f) => f.id)));
      setScored(true);
      setStage("revealed");
      return;
    }

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    // Weakest first — the field narrows from the bottom, winner + runner-up last.
    const order = finalists.slice(2).reverse(); // everyone except winner(0) & runner-up(1)

    at(520, () => setScored(true)); // scores resolve on the cards
    const think = setInterval(() => setThinking((i) => (i + 1) % THINKING.length), 640);
    timers.current.push(think as unknown as ReturnType<typeof setTimeout>);

    at(2400, () => setStage("eliminating"));
    order.forEach((f, k) => at(2400 + k * 480, () => setEliminated((s) => new Set(s).add(f.id))));

    const twoAt = 2400 + order.length * 480 + 260;
    at(twoAt, () => setStage("finaltwo"));
    at(twoAt + 720, () => {
      setStage("crowning");
      setEliminated((s) => new Set(s).add(finalists[1].id)); // runner-up recedes
      clearInterval(think);
    });
    at(twoAt + 720 + 1180, () => setStage("revealed"));

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      clearInterval(think);
    };
  }, [finalists]);

  const build = () => {
    if (launching) return;
    setLaunching(true);
    // "We've found your business. Now let's build it." — zoom, then hand off.
    setTimeout(() => router.push("/dashboard"), 620);
  };

  const showGrid = stage === "analyzing" || stage === "eliminating" || stage === "finaltwo" || stage === "crowning";
  const showHero = stage === "crowning" || stage === "revealed";
  const dark = stage === "crowning" || stage === "revealed";

  return (
    <div className="u-float relative mt-6 overflow-hidden rounded-2xl border border-hair bg-[#0a1020] p-5 sm:p-7">
      {/* Header — the AI narrating its own reasoning */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-gold opacity-60" style={{ animation: dark ? "none" : "urivo-live 1.4s ease-in-out infinite" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
            {stage === "analyzing" && "Urivo AI · analyzing candidates"}
            {stage === "eliminating" && "Urivo AI · narrowing the field"}
            {stage === "finaltwo" && "Urivo AI · final two"}
            {(stage === "crowning" || stage === "revealed") && "Urivo AI · decision"}
          </p>
        </div>
        {!dark && (
          <p key={thinking} className="u-msg-in hidden text-[11px] text-gold-soft sm:block" aria-live="polite">
            {THINKING[thinking]}
          </p>
        )}
      </div>

      {/* Stage — the field cross-fades into the crowned winner */}
      <div className="relative mt-5 min-h-[420px]">
        {/* subtle darkening as the decision lands */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -m-5 z-0 transition-opacity duration-700 sm:-m-7"
          style={{ background: "radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.5) 100%)", opacity: dark ? 1 : 0 }}
        />

        {showGrid && (
          <div
            className={`relative z-10 transition-all duration-500 ${
              stage === "crowning" ? "pointer-events-none absolute inset-0 scale-[0.97] opacity-0" : "opacity-100"
            }`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {finalists.map((f) => (
                <FinalistCard
                  key={f.id}
                  f={f}
                  scored={scored}
                  eliminated={eliminated.has(f.id)}
                  focused={stage === "finaltwo" && (f.id === winner.id || f.id === finalists[1].id)}
                  isWinner={f.id === winner.id}
                />
              ))}
            </div>
          </div>
        )}

        {showHero && (
          <div className="relative z-10">
            <WinnerHero winner={winner} expanded={expanded} onToggle={() => setExpanded((v) => !v)} onBuild={build} launching={launching} revealed={stage === "revealed"} />
          </div>
        )}
      </div>

      {/* Advanced (Pro) — the crowned store's full seven-signal fitness breakdown */}
      {tier === "advanced" && stage === "revealed" && (
        <div className="relative z-10 mt-6 rounded-xl border border-hair bg-panel/60 p-5" style={{ animation: "urivo-fade-up 600ms var(--ease-urivo) 400ms both" }}>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist">Advanced Evolution · seven-signal breakdown</p>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {winner.signals.map((s) => (
              <div key={s.key}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] text-ivory">{s.label}</span>
                  <span className="text-[12.5px] font-semibold tabular-nums u-gold-text">{s.value}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${s.value}%`, backgroundImage: "var(--grad-gold)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Finalist store card ─────────────────────────────────────────────────── */
function FinalistCard({
  f,
  scored,
  eliminated,
  focused,
  isWinner,
}: {
  f: Finalist;
  scored: boolean;
  eliminated: boolean;
  focused: boolean;
  isWinner: boolean;
}) {
  const p = f.palette;
  return (
    <div
      className="relative overflow-hidden rounded-xl border transition-all duration-500 will-change-transform"
      style={{
        borderColor: focused ? "rgba(224,192,105,0.7)" : "rgba(34,48,73,0.9)",
        opacity: eliminated ? 0.18 : 1,
        transform: eliminated ? "scale(0.94) translateY(6px)" : focused ? "scale(1.03)" : "scale(1)",
        filter: eliminated ? "grayscale(1) blur(2.5px)" : "none",
        boxShadow: focused ? "0 18px 44px -22px rgba(224,192,105,0.5)" : "none",
      }}
      aria-label={`${f.name} — Urivo Score ${f.score}${eliminated ? ", eliminated" : ""}`}
    >
      {/* mini storefront preview */}
      <div style={{ background: p.bg }} className="p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-tight" style={{ color: p.ink }}>{f.name}</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.accent }} />
        </div>
        <p className="mt-0.5 text-[8px] uppercase tracking-wider" style={{ color: p.muted }}>{f.category}</p>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-square rounded" style={{ background: p.panel }}>
              <div className="mt-[70%] mx-1 h-0.5 rounded-full" style={{ background: p.accent, opacity: 0.5 }} />
            </div>
          ))}
        </div>
      </div>
      {/* score / status footer */}
      <div className="flex items-center justify-between border-t border-hair bg-panel/80 px-2.5 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mist-dim">Urivo Score</span>
        {eliminated ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-alert">
            <span className="h-1.5 w-1.5 rounded-full bg-alert" /> Out
          </span>
        ) : scored ? (
          <span className={`text-[13px] font-semibold tabular-nums ${isWinner ? "u-gold-text" : "text-ivory"}`}>
            <ScoreCount value={f.score} />
          </span>
        ) : (
          <span className="u-skel h-3 w-8 rounded" />
        )}
      </div>
      {/* analyzing border pulse while scores resolve */}
      {!scored && !eliminated && (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl border" style={{ animation: "urivo-analyze 1.2s ease-in-out infinite", borderColor: "rgba(224,192,105,0.3)" }} />
      )}
    </div>
  );
}

/* ── Winner hero ─────────────────────────────────────────────────────────── */
function WinnerHero({
  winner,
  expanded,
  onToggle,
  onBuild,
  launching,
  revealed,
}: {
  winner: Finalist;
  expanded: boolean;
  onToggle: () => void;
  onBuild: () => void;
  launching: boolean;
  revealed: boolean;
}) {
  const p = winner.palette;
  return (
    <div
      className="mx-auto max-w-xl"
      style={{ animation: launching ? "urivo-hero-launch 620ms var(--ease-urivo) forwards" : "urivo-fade-up 700ms var(--ease-urivo) both" }}
    >
      {/* The crowned store card */}
      <div className="relative mx-auto max-w-sm overflow-hidden rounded-2xl u-goldcrown">
        {/* single pass of gold light */}
        <span aria-hidden className="pointer-events-none absolute inset-0 z-20" style={{ background: "linear-gradient(105deg, transparent 30%, rgba(248,236,192,0.55) 50%, transparent 70%)", animation: "urivo-goldsweep 1100ms var(--ease-urivo) 250ms both" }} />
        <div style={{ background: p.bg }} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-semibold tracking-tight" style={{ color: p.ink }}>{winner.name}</p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: p.muted }}>{winner.category}</p>
            </div>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ background: p.accent, color: p.dark ? p.bg : "#fff" }}>Store v1.0</span>
          </div>
          <p className="mt-1 text-[11px] italic" style={{ color: p.muted }}>{winner.tagline}</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-square rounded-md" style={{ background: p.panel }}>
                <div className="mt-[64%] mx-1.5 h-1 rounded-full" style={{ background: p.accent, opacity: 0.55 }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div className="mt-5 text-center" style={{ animation: revealed ? "urivo-fade-up 600ms var(--ease-urivo) 120ms both" : "none", opacity: revealed ? undefined : 0 }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-soft">Recommended by Urivo AI</p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <Stars />
          <span className="text-[26px] font-semibold leading-none tracking-tight u-gold-text tabular-nums">
            <ScoreCount value={winner.score} big />
          </span>
        </div>
        <p className="mt-1 text-xs text-mist">Urivo Score · Highest predicted success</p>

        {/* Confidence */}
        <div className="mx-auto mt-4 flex max-w-xs items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-mist">Confidence</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{ width: revealed ? `${winner.confidence}%` : "0%", backgroundImage: "var(--grad-gold)", transition: "width 1100ms var(--ease-urivo) 200ms" }} />
          </div>
          <span className="text-[13px] font-semibold tabular-nums u-gold-text">{winner.confidence}%</span>
        </div>

        {/* Reasons */}
        <ul className="mx-auto mt-5 max-w-sm space-y-1.5 text-left">
          {winner.reasons.slice(0, expanded ? winner.reasons.length : 5).map((r, i) => (
            <li key={r} className="flex items-center gap-2 text-[13px] text-cloud" style={{ animation: revealed ? `urivo-fade-up 500ms var(--ease-urivo) ${180 + i * 70}ms both` : "none", opacity: revealed ? undefined : 0 }}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-live/15 text-live">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              {r}
            </li>
          ))}
        </ul>

        {winner.reasons.length > 5 && (
          <button onClick={onToggle} className="u-press mt-3 text-[11px] font-semibold text-gold-soft transition-colors hover:text-gold">
            {expanded ? "Show less" : "See why"}
          </button>
        )}

        <div className="mt-6">
          <button
            onClick={onBuild}
            disabled={launching}
            className="u-gold u-lift inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-70"
          >
            {launching ? "Opening your store…" : "Build this store"}
            {!launching && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
          </button>
          <p className="mt-2.5 text-[11px] text-mist-dim">We&apos;ve found your business. Now let&apos;s build it.</p>
        </div>
      </div>
    </div>
  );
}

function Stars() {
  return (
    <span className="flex items-center gap-0.5" aria-label="Five stars">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="url(#starGold)" aria-hidden style={{ animation: `urivo-fade-up 400ms var(--ease-urivo) ${i * 80}ms both` }}>
          <defs>
            <linearGradient id="starGold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f8ecc0" />
              <stop offset="100%" stopColor="#cfa14a" />
            </linearGradient>
          </defs>
          <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.9l-5.81 3.05 1.11-6.47-4.7-4.58 6.5-.95z" />
        </svg>
      ))}
    </span>
  );
}

/* Lightweight count-up used on the cards + the hero score. */
function ScoreCount({ value, big }: { value: number; big?: boolean }) {
  const [n, setN] = useState(prefersReducedMotion() ? value : 0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setN(value);
      return;
    }
    const dur = big ? 900 : 600;
    const start = performance.now();
    const tick = (t: number) => {
      const pr = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - pr, 3);
      setN(Math.round(value * eased));
      if (pr < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, big]);
  return <>{n}</>;
}
